import crypto from 'crypto';
import ical from 'ical.js';
import { CustomEvent, EventPredicate } from '../events/event.js';

/**
 * Interface for calendar extension configuration
 */
export interface CalendarExtensionConfig {
    /**
     * Whether to escape special characters in fields
     */
    escapeSpecialCharacters?: boolean;
    /**
     * Custom events to add to the calendar.
     */
    customEvents?: CustomEvent[];
}

/**
 * Interface for extracted details from the iCalendar data
 */
export interface ExtractedDetails {
    subject?: string;
}

/**
 * Defines a replacement for the PRODID field in the iCalendar data
 */
export interface ReplaceProdIdConfig {
    /**
     * The replacement value for the PRODID field
     */
    replacement: string;
}

/**
 * Defines a configuration for collapsing recurring events
 */
export interface RecurrenceCollapseConfig {
    /**
     * The keys that must match for two events to be considered part of the same series
     */
    requiredMatchingKeys: string[];
    /**
     * The frequency to match subsequent events
     */
    frequency: 'daily' | 'weekly';
}

/**
 * Defines a configuration for rewriting event fields
 */
export interface EventFieldRewriterConfig {
    /**
     * An array of patterns to match and rewrite
     */
    patterns: {
        /**
         * The key of the property to rewrite
         */
        propertyKey: string;
        /**
         * The key of the property to use as the starting value
         */
        sourceKey: string;
        /**
         * Whether to use the original source value or its current value (if changed by pattern)
         */
        useOriginalSourceValue: boolean;
        /**
         * The value rewriter to use
         */
        rewriter: {
            /**
             * Regular expression to match against
             */
            regex: RegExp;
            /**
             * Replacement string to use for rewriting
             */
            replacement: string;
        } | {
            /**
             * Rewriting function to use
             * @param sourceValue the base value to rewrite
             * @returns the rewritten value
             */
            format: (sourceValue: string) => string;
        };
    }[];
}

/**
 * Defines a configuration for replacing event UIDs
 */
export interface UidFixupConfig {
    /**
     * Whether to fix up before or after other operations have been performed
     */
    fixupFirst: boolean;
    /**
     * The prefix to use for new UIDs
     */
    prefix: {
        /**
         * The literal value to use as a prefix
         */
        value: string;
    } | {
        /**
         * Regular expression to match against the original UID
         */
        regex: RegExp;
        /**
         * Replacement string to use for the prefix
         */
        replacement: string;
    };
    /**
     * The method to use for deriving new UIDs
     */
    derivation: 'DTSTART_MD5';
}

/**
 * Base class for formatters that can modify iCalendar data
 */
export abstract class Formatter {
    /**
     * The current configuration for replacing the PRODID field
     */
    protected replaceProdIdConfig?: ReplaceProdIdConfig;
    /**
     * The current configuration for collapsing recurring events
     */
    protected recurrenceCollapseConfig?: RecurrenceCollapseConfig;
    /**
     * The current configuration for rewriting event fields
     */
    protected eventFieldRewriterConfig?: EventFieldRewriterConfig;
    /**
     * The current configuration for fixing up event UIDs
     */
    protected uidFixupConfig?: UidFixupConfig;

    /**
     * The current configuration for calendar extensions
     */
    protected extensionConfig?: CalendarExtensionConfig;

    /**
     * Gets the name of the formatter
     * @returns the name of the formatter
     */
    abstract getName(): string;

    /**
     * Extracts reusable details from the iCalendar data
     * @param root the data as an iCalendar component (VCALENDAR)
     * @returns the extracted details
     */
    abstract extractDetails(root: ical.Component): ExtractedDetails;

    /**
     * Formats the provided iCalendar data
     * @param root the data as an iCalendar component (VCALENDAR)
     * @returns the formatted iCalendar component (VCALENDAR)
     */
    format(root: ical.Component): ical.Component {
        const details = this.extractDetails(root);

        if (this.shouldReplaceProdID()) {
            root = this.replaceProdId(root);
        }
        if (this.shouldFixupUids()) {
            root = this.fixupUids(root, 'first');
        }
        if (this.shouldCollapseRecurrences()) {
            root = this.collapseRecurrences(root);
        }
        if (this.shouldRewriteEventFields()) {
            root = this.rewriteEventFields(root);
        }
        if (this.shouldAddAdditionalEvents()) {
            root = this.addAdditionalEvents(root, details);
        }
        if (this.shouldFixupUids()) {
            root = this.fixupUids(root, 'last');
        }
        return root;
    }

    /**
     * Get whether the formatter should replace the PRODID field
     * @returns true if the formatter should replace the PRODID field
     */
    shouldReplaceProdID(): boolean {
        return this.replaceProdIdConfig !== undefined;
    }

    /**
     * Get whether the formatter should collapse recurring events
     * @returns true if the formatter should collapse recurring events
     */
    shouldCollapseRecurrences(): boolean {
        return this.recurrenceCollapseConfig !== undefined;
    }

    /**
     * Get whether the formatter should add additional events
     * @returns true if the formatter should add additional events
     */
    shouldAddAdditionalEvents(): boolean {
        return this.extensionConfig !== undefined;
    }

    /**
     * Get whether the formatter should rewrite event fields
     * @returns true if the formatter should rewrite event fields
     */
    shouldRewriteEventFields(): boolean {
        return this.eventFieldRewriterConfig !== undefined;
    }

    /**
     * Get whether the formatter should fix up event UIDs
     * @returns true if the formatter should fix up event UIDs
     */
    shouldFixupUids(): boolean {
        return this.uidFixupConfig !== undefined;
    }

    /**
     * Sets the extension configuration for the formatter
     * @param extensionConfig the extension configuration to use
     */
    setExtensions(extensionConfig: CalendarExtensionConfig) {
        this.extensionConfig = extensionConfig;
    }

    /**
     * Replaces the PRODID field in the iCalendar data with the configured value
     * @param root the iCalendar component (VCALENDAR) to modify
     * @returns the modified iCalendar component (VCALENDAR)
     */
    replaceProdId(root: ical.Component): ical.Component {
        root.updatePropertyWithValue('prodid', this.replaceProdIdConfig!.replacement);
        return root;
    }

    /**
     * Fixes and updates the UIDs of events in the iCalendar data based on the configured settings
     * @param root the iCalendar component (VCALENDAR) to modify
     * @param step the current step in the formatting process
     * @returns the modified iCalendar component (VCALENDAR)
     */
    fixupUids(root: ical.Component, step: 'first' | 'last'): ical.Component {
        const config = this.uidFixupConfig!;
        if ((step === 'first' && !config.fixupFirst) || (step === 'last' && config.fixupFirst)) {
            return root;
        }

        const originalVevents = root.getAllSubcomponents('vevent');
        if (originalVevents.length === 0) {
            return root;
        }

        const prefix = 'value' in config.prefix ? config.prefix.value : undefined;

        for (const vevent of originalVevents) {
            const originalUid = vevent.getFirstPropertyValue('uid') as string | null;
            if (!originalUid) {
                throw new Error('UID is required');
            }

            let actualPrefix = prefix;
            if ('regex' in config.prefix) {
                actualPrefix = originalUid.replace(config.prefix.regex, config.prefix.replacement);
            }

            let newUid = originalUid;

            switch (config.derivation) {
                case 'DTSTART_MD5': {
                    const dtstart = vevent.getFirstPropertyValue('dtstart') as ical.Time | null;
                    if (!dtstart) {
                        throw new Error('DTSTART is required');
                    }

                    const hash = crypto.createHash('md5');
                    hash.update(dtstart.toUnixTime().toString(16));
                    const hashValue = hash.digest('hex');

                    newUid = `${actualPrefix}${hashValue}`;
                    break;
                }
            }

            vevent.updatePropertyWithValue('uid', newUid);
        }

        return root;
    }

    /**
     * Collapses recurring events in the iCalendar data based on the configured settings
     * @param root the iCalendar component (VCALENDAR) to modify
     * @returns the modified iCalendar component (VCALENDAR)
     */
    collapseRecurrences(root: ical.Component): ical.Component {
        const originalVevents = root.getAllSubcomponents('vevent');
        root.removeAllSubcomponents('vevent');

        const flattenedVevents = collapseSelectedRecurrences(originalVevents, this.recurrenceCollapseConfig!);
        for (const vevent of flattenedVevents) {
            root.addSubcomponent(vevent);
        }

        return root;
    }

    /**
     * Adds additional events to the iCalendar data based on the configured settings
     * @param root the iCalendar component (VCALENDAR) to modify
     * @param details the extracted details from the original iCalendar data
     * @returns the modified iCalendar component (VCALENDAR)
     */
    addAdditionalEvents(root: ical.Component, details: ExtractedDetails): ical.Component {
        if (this.extensionConfig?.customEvents) {
            const useEscapeRules = this.extensionConfig.escapeSpecialCharacters ?? false;
            for (const event of this.extensionConfig.customEvents) {
                let skip = false;
                for (const condition of event.conditions) {
                    if (!this.checkCondition(root, condition)) {
                        skip = true;
                        break;
                    }
                }

                if (skip) {
                    continue;
                }

                const vevent = new ical.Component('vevent');
                const uid = this.getUid(event, details);
                vevent.addPropertyWithValue('uid', uid);
                
                vevent.addPropertyWithValue('dtstamp', event.dtstamp);
                const dtstart = vevent.addPropertyWithValue('dtstart', ical.Time.fromDateTimeString(event.dtstart));
                const dtend = vevent.addPropertyWithValue('dtend', ical.Time.fromDateTimeString(event.dtend));

                if (event.tzid) {
                    dtstart.setParameter('tzid', event.tzid);
                    dtend.setParameter('tzid', event.tzid);
                }

                for (const [key, value] of Object.entries(event.properties)) {
                    if (key !== 'uid') {
                        vevent.addPropertyWithValue(key, useEscapeRules ? this.applyEscapeRules(value) : value);
                    }
                }

                root.addSubcomponent(vevent);
            }
        }

        return root;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getUid(eventView: CustomEvent, _details: ExtractedDetails): string {
        const data = `${eventView.dtstamp}${eventView.properties.summary}`;
        return 'custom_' + this.hashContent(data);
    }

    checkCondition(root: ical.Component, condition: EventPredicate): boolean {
        const vevents = root.getAllSubcomponents('vevent');
        const veventCount = vevents.length;
        let toMatch = condition.match == 'any' ? 1 : condition.match == 'all' ? veventCount : condition.match;
        
        for (let i = 0; i < veventCount && toMatch > 0 && toMatch <= veventCount - i; i++) {
            if (testEventPredicate(vevents[i], condition)) {
                toMatch--;
            }
        }

        return toMatch == 0;
    }

    applyEscapeRules(src: string): string {
        return src.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
    }

    /**
     * Uses the default hashing algorithm to hash the provided content
     * @param content the content to hash
     * @returns the hash
     */
    hashContent(content: string): string {
        const hash = crypto.createHash('md5');
        hash.update(content);
        return hash.digest('hex');
    }

    /**
     * Rewrites event fields in the iCalendar data based on the configured settings
     * @param root the iCalendar component (VCALENDAR) to modify
     * @returns the modified iCalendar component (VCALENDAR)
     */
    rewriteEventFields(root: ical.Component): ical.Component {
        const originalVevents = root.getAllSubcomponents('vevent');
        for (const vevent of originalVevents) {
            rewriteComponent(vevent, this.eventFieldRewriterConfig!);
        }

        return root;
    }
}

/**
 * Holds information about a recurrence match in progress
 */
interface RecurrenceInProgress {
    /**
     * The base event for the recurrence (first in series)
     */
    baseEvent: ical.Component;
    /**
     * The requirements that must be met for a match as key-value pairs
     */
    matchRequirements: Map<string, string | null>;
    /**
     * The next time we require for the series to continue
     */
    nextTime: ical.Time;
    /**
     * The recurrence object for the series
     */
    recurrence: ical.Recur;
}

/**
 * Reduces a given array of event components into another array of events with recurrence rules set
 * @param vevents the array of event components (VEVENT) to collapse
 * @param settings the configuration for collapsing recurrences
 * @returns the array of event components (VEVENT) with recurrence rules set
 */
function collapseSelectedRecurrences(vevents: ical.Component[], settings: RecurrenceCollapseConfig): ical.Component[] {
    // sort events by start date
    const sorted = vevents
    .map(vevent => {
        const start = vevent.getFirstPropertyValue('dtstart') as ical.Time | null;
        if (start) {
            return { start, vevent };
        }
        return null;
    })
    .filter(x => x !== null)
    .sort((a, b) => {
        if (a && b) {
            return a.start.compare(b.start);
        }
        return 0;
    })
    .map(x => x.vevent);

    const output: ical.Component[] = [];
    const inProgress: RecurrenceInProgress[] = [];

    for (const vevent of sorted) {
        // check if vevent is a recurrence, and add directly to recurrences if it is
        const rrule = vevent.getFirstPropertyValue('rrule');
        if (rrule) {
            output.push(vevent);
            continue;
        }

        // check if we have a recurrence in progress that matches this event
        let found = false;
        for (const recurrence of inProgress) {
            let match = true;
            for (const key of settings.requiredMatchingKeys) {
                if (recurrence.matchRequirements.get(key) !== vevent.getFirstPropertyValue(key)) {
                    match = false;
                    break;
                }
            }

            if (!match) {
                continue;
            }

            // check if next time is what we expect
            const start = vevent.getFirstPropertyValue('dtstart') as ical.Time | null;

            if (start && recurrence.nextTime.compare(start) === 0) {
                // we need to set up the recurrence properties for this vevent
                recurrence.recurrence.count! += 1;
                recurrence.nextTime = getFutureOccurrenceTime(recurrence.nextTime, settings.frequency);
                found = true;
                break;
            }
        }

        // if no match, create a new recurrence
        if (!found) {
            const start = vevent.getFirstPropertyValue('dtstart') as ical.Time | null;
            if (start) {
                const matchRequirements = new Map<string, string | null>();
                for (const key of settings.requiredMatchingKeys) {
                    matchRequirements.set(key, vevent.getFirstPropertyValue(key)?.toString() ?? null);
                }

                const nextTime = getFutureOccurrenceTime(start, settings.frequency);

                // create a new recurrence
                const recurrenceData = {
                    freq: settings.frequency.toUpperCase(),
                    count: 1,
                    byday: undefined as string[] | undefined
                };
                if (settings.frequency === 'weekly') {
                    const dayOfWeek = start.dayOfWeek();
                    switch (dayOfWeek) {
                        case ical.Time.SUNDAY:
                            recurrenceData.byday = ['SU'];
                            break;
                        case ical.Time.MONDAY:
                            recurrenceData.byday = ['MO'];
                            break;
                        case ical.Time.TUESDAY:
                            recurrenceData.byday = ['TU'];
                            break;
                        case ical.Time.WEDNESDAY:
                            recurrenceData.byday = ['WE'];
                            break;
                        case ical.Time.THURSDAY:
                            recurrenceData.byday = ['TH'];
                            break;
                        case ical.Time.FRIDAY:
                            recurrenceData.byday = ['FR'];
                            break;
                        case ical.Time.SATURDAY:
                            recurrenceData.byday = ['SA'];
                            break;
                    }
                }

                inProgress.push({
                    baseEvent: vevent,
                    matchRequirements,
                    nextTime,
                    recurrence: new ical.Recur(recurrenceData)
                });
            }
        }
    }

    // add any remaining recurrences in progress
    for (const recurrence of inProgress) {
        const vevent = recurrence.baseEvent;
        if (recurrence.recurrence.count && recurrence.recurrence.count > 1) {
            vevent.addPropertyWithValue('rrule', recurrence.recurrence);
        }
        output.push(vevent);
    }

    return output;
}

/**
 * Get the next occurrence time for a given origin time and frequency
 * @param now the origin time
 * @param frequency the frequency to use
 * @returns the next time to expect an occurrence
 */
function getFutureOccurrenceTime(now: ical.Time, frequency: 'daily' | 'weekly'): ical.Time {
    switch (frequency) {
        case 'daily':
            return now.adjust(1, 0, 0, 0);
        case 'weekly':
            return now.adjust(7, 0, 0, 0);
    }
}

/**
 * Rewrites the properties of a component based on the provided settings
 * @param component the component to rewrite
 * @param settings the configuration for rewriting event fields
 */
function rewriteComponent(component: ical.Component, settings: EventFieldRewriterConfig): void {
    const originalValuesLazy = new Map<string, string>();

    for (const pattern of settings.patterns) {
        const propertyKey = pattern.propertyKey;

        // store property if not there
        if (!originalValuesLazy.has(propertyKey)) {
            const originalValue = component.getFirstPropertyValue(propertyKey)?.toString() ?? '';
            originalValuesLazy.set(propertyKey, originalValue);
        }

        const sourceKey = pattern.sourceKey;
        let sourceValue = pattern.useOriginalSourceValue ? originalValuesLazy.get(sourceKey) : undefined;
        sourceValue ??= (component.getFirstPropertyValue(sourceKey)?.toString() ?? '');

        const rewriter = pattern.rewriter;
        if ('format' in rewriter) {
            component.updatePropertyWithValue(propertyKey, rewriter.format(sourceValue));
        }
        else {
            component.updatePropertyWithValue(propertyKey, sourceValue.replace(rewriter.regex, rewriter.replacement));
        }
    }
}

function testEventPredicate(vevent: ical.Component, predicate: EventPredicate): boolean {
    const propertyValue = vevent.getFirstPropertyValue(predicate.propertyKey);
    if (!propertyValue) {
        return false;
    }

    let valueString = propertyValue.toString();
    let expectedValue = predicate.method.value;
    if ('ignoreCase' in predicate.method && predicate.method.ignoreCase) {
        valueString = valueString.toLowerCase();
        expectedValue = expectedValue.toLowerCase();
    }

    switch (predicate.method.type) {
        case 'equals':
            return valueString === expectedValue;
        case 'contains':
            return valueString.includes(expectedValue);
        case 'startsWith':
            return valueString.startsWith(expectedValue);
        case 'endsWith':
            return valueString.endsWith(expectedValue);
        case 'regex':
            return new RegExp(expectedValue).test(valueString);
        default:
            return false;
    }
}
