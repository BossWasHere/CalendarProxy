import axios from 'axios';
import crc32 from 'crc-32';
import express from 'express';
import NodeCache from 'node-cache';
import 'dotenv/config';
import { Calendar } from './calendar.js';
import { getFormatter } from './formatters/index.js';

//
//  Configuration
//

/**
 * Interface for global settings
 */
interface Settings {
    /**
     * Port to listen on
     */
    PORT: number;
    /**
     * Cache time-to-live in seconds
     */
    CACHE_TTL: number;
    /**
     * Maximum number of items in the cache
     */
    CACHE_MAX_KEYS: number;
    /**
     * How frequently a calendar can be force-reloaded in seconds
     */
    FORCE_RELOAD_TIMEOUT: number;
    /**
     * Whether to respect the interval (how frequently a calendar should be reloaded)
     * when specified in the calendar itself
     */
    RESPECT_ICAL_REFRESH_INTERVAL: boolean;
    /**
     * Whether to include exception messages in error responses
     */
    INCLUDE_EXCEPTIONS: boolean;
    /**
     * User agent to use when fetching remote calendars
     */
    USER_AGENT?: string;
}

/**
 * Try parse an int from string
 * @param value the optional string value to parse
 * @param defaultValue the default value to return if not parsed
 * @returns the parsed integer or the default value
 */
function tryParseInt(value: string | undefined, defaultValue: number): number {
    if (value === undefined) {
        return defaultValue;
    }

    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Default settings
 */
const DOTENV_DEFAULTS: Settings = {
    PORT: 3000,
    CACHE_TTL: 60 * 60,
    CACHE_MAX_KEYS: 100,
    FORCE_RELOAD_TIMEOUT: 60 * 5,
    RESPECT_ICAL_REFRESH_INTERVAL: false,
    INCLUDE_EXCEPTIONS: false,
};

const SETTINGS: Settings = {
    CACHE_TTL: tryParseInt(process.env.CACHE_TTL, DOTENV_DEFAULTS.CACHE_TTL),
    CACHE_MAX_KEYS: tryParseInt(process.env.CACHE_MAX_KEYS, DOTENV_DEFAULTS.CACHE_MAX_KEYS),
    PORT: tryParseInt(process.env.PORT, DOTENV_DEFAULTS.PORT),
    FORCE_RELOAD_TIMEOUT: tryParseInt(process.env.FORCE_RELOAD_TIMEOUT, DOTENV_DEFAULTS.FORCE_RELOAD_TIMEOUT),
    RESPECT_ICAL_REFRESH_INTERVAL: process.env.RESPECT_ICAL_REFRESH_INTERVAL === 'true',
    INCLUDE_EXCEPTIONS: process.env.INCLUDE_EXCEPTIONS === 'true',
    USER_AGENT: process.env.USER_AGENT,
};


//
//  Cache
//

/**
 * Interface for calendar error
 */
interface CalendarError {
    error: string;
    details: string;
}

/**
 * Maps the hash of the source calendar file to the URL it came from
 */
const sourceHashMapping = new Map<number, string>();
/**
 * Caches original and formatted calendar data for a given URL
 */
const calendarCache = new NodeCache({stdTTL: SETTINGS.CACHE_TTL, maxKeys: SETTINGS.CACHE_MAX_KEYS});

calendarCache.addListener('expired', (key: string, value: Calendar) => {
    console.log(`Cache expired for ${key}`);
    sourceHashMapping.delete(value.getSourceUid());
});

/**
 * Fetches the calendar from the remote server and updates the cache if the source has changed
 * @param calendarUrl the URL of the calendar
 * @param formatterName the formatter to use, or undefined if no formatter should be used
 * @param lastEntry the last cached calendar entry to return if the source has not changed, or undefined if there is no last entry
 * @returns the updated calendar or an error result
 */
async function reloadCalendar(calendarUrl: string, formatterName?: string, lastEntry?: Calendar): Promise<Calendar | CalendarError> {
    const axiosConfig = SETTINGS.USER_AGENT ? {headers: {'User-Agent': SETTINGS.USER_AGENT}} : undefined;
    const response = await axios.get(calendarUrl, axiosConfig);
    if (response.status !== 200) {
        return {
            error: 'Failed to fetch calendar from remote',
            details: `GET from '${calendarUrl}' returned status code: ${response.status}`,
        };
    }

    const sourceHash = crc32.str(response.data);
    if (lastEntry !== undefined && sourceHash === lastEntry.getSourceUid()) {
        lastEntry.setReloaded();
        return lastEntry;
    }

    const formatter = formatterName ? getFormatter(formatterName) : undefined;
    if (formatterName !== undefined && formatter === undefined) {
        return {
            error: 'Invalid formatter name',
            details: `Formatter '${formatterName}' not found`,
        };
    }

    let newEntry: Calendar;
    try {
        newEntry = new Calendar(response.data, sourceHash);
    }
    catch (ex) {
        return {
            error: 'Failed to parse calendar',
            details: (ex as Error).message ?? 'Unknown error',
        };
    }

    try {
        if (formatter !== undefined) {
            newEntry.applyFormatter(formatter);
        }
    }
    catch (ex) {
        return {
            error: `Failed to apply formatter ${formatterName}`,
            details: (ex as Error).message ?? 'Unknown error',
        };
    }

    calendarCache.set(calendarUrl, newEntry);
    sourceHashMapping.set(sourceHash, calendarUrl);
    
    return newEntry;
}

/**
 * Gets the calendar from the cache, or fetches it from the remote server if it is not in the cache
 * @param calendarUrl the URL of the calendar
 * @param wantsReload whether to request a forced reload of the calendar
 * @param formatter the formatter to use, or undefined if no formatter should be used
 * @returns the calendar or an error result
 */
function getCalendar(calendarUrl: string, wantsReload: boolean, formatter?: string): Promise<Calendar | CalendarError> {
    const cacheEntry = calendarCache.get<Calendar>(calendarUrl);
    if (cacheEntry === undefined) {
        return reloadCalendar(calendarUrl, formatter);
    }

    if (wantsReload && cacheEntry.shouldReload(SETTINGS.FORCE_RELOAD_TIMEOUT, SETTINGS.RESPECT_ICAL_REFRESH_INTERVAL)) {
        return reloadCalendar(calendarUrl, formatter, cacheEntry);
    }

    return Promise.resolve(cacheEntry);
}

//
//  Endpoints
//

/**
 * Interface for calendar request
 */
interface CalendarRequest {
    /**
     * The requested formatter
     */
    formatter: string;
    /**
     * The requested calendar URL
     */
    calendarUrl: string;
}

/**
 * Handles the calendar format request
 * @param req the request
 * @param res the response
 * @returns empty promise
 */
async function formatCalendarHandle(req: express.Request<CalendarRequest>, res: express.Response) {
    const wantsReload = req.query.reload === 'true';
    let formatter: string | undefined = req.params.formatter;
    if (formatter === 'default') {
        formatter = undefined;
    }

    const calendarUrl = req.params.calendarUrl;
    if (!calendarUrl.startsWith('http:') && !calendarUrl.startsWith('https:')) {
        res.status(400).send({error: 'Requires HTTP or HTTPS protocol'});
        return;
    }

    const calendar = await getCalendar(calendarUrl, wantsReload, formatter);
    if ('error' in calendar) {
        if (SETTINGS.INCLUDE_EXCEPTIONS) {
            res.status(500).send(calendar);
        } else {
            res.status(500).send({error: calendar.error});
        }
    } else {
        res.setHeader('Content-Type', 'text/calendar');
        res.send(calendar.toString());
    }
}

//
//  Main
//

const app = express();

app.get('/:formatter/:calendarUrl', formatCalendarHandle);

const server = app.listen(SETTINGS.PORT, () => {
    console.log(`Server listening on port ${SETTINGS.PORT}`);
});

/**
 * Shutdown the server
 */
function shutdown() {
    console.log('Stopping server...');
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
}

// intercept SIGINT and gracefully stop the server
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
