// @ts-expect-error Type declarations for ical.js are missing
import ical from 'ical.js';
import { Formatter } from './formatters/index.js';

/**
 * Wrapper around ical.js calendar component for caching and formatting
 */
export class Calendar {
    private src: string;
    private srcUid: number;
    private lastReload: number;

    private rootComponent: ical.Component;
    private formattedOutputCache: string | null = null;
    private refreshInterval: number | undefined = undefined;

    /**
     * Constructor
     * @param src the source calendar data
     * @param srcUid the unique identifier of the source calendar data
     * 
     * @throws Error if the source data is invalid and could not be parsed
     */
    constructor(src: string, srcUid: number) {
        this.src = src;
        this.srcUid = srcUid;
        this.lastReload = Date.now();
        this.rootComponent = ical.Component.fromString(src);

        const refreshInterval = this.rootComponent.getFirstPropertyValue("refresh-interval") as ical.Duration | null;
        if (refreshInterval && 'toSeconds' in refreshInterval) {
            this.refreshInterval = refreshInterval.toSeconds();
        }
    }

    /**
     * Get the source calendar data
     * @returns source calendar data
     */
    getSource(): string {
        return this.src;
    }

    /**
     * Get the unique identifier of the source calendar data
     * @returns unique identifier
     */
    getSourceUid(): number {
        return this.srcUid;
    }

    /**
     * Gets the Unix timestamp of the last reload
     * @returns last reload timestamp
     */
    getLastReload(): number {
        return this.lastReload;
    }

    /**
     * Sets the last reload timestamp to the current time
     */
    setReloaded() {
        this.lastReload = Date.now();
    }

    /**
     * Get whether the calendar has a RERESH-INTERVAL property
     * @returns true if it has the property, false otherwise
     */
    hasRefreshInterval(): boolean {
        return this.refreshInterval !== undefined;
    }

    /**
     * Get the REFRESH-INTERVAL property value in seconds
     * @returns the refresh interval in seconds or 0 if not set
     */
    getRefreshInterval(): number {
        return this.refreshInterval ?? 0;
    }

    /**
     * Determines if consumers should consider reloading the calendar source data.
     * @param externalInterval the minimum interval in seconds
     * @param respectInternalInterval if true, will only return true if both the
     * internal and external intervals are passed
     * @returns true if the calendar should be reloaded, false otherwise
     */
    shouldReload(externalInterval: number, respectInternalInterval: boolean): boolean {
        const delta = Date.now() - this.lastReload;
        return (!respectInternalInterval || delta > this.getRefreshInterval()) && delta > externalInterval;

    }

    /**
     * Applies a formatter to the calendar
     * @param formatter the formatter to apply
     * @throws Error if the formatter fails
     */
    applyFormatter(formatter: Formatter) {
        this.rootComponent = formatter.format(this.rootComponent);
        this.formattedOutputCache = null;
    }

    /**
     * Converts the calendar to its ICAL string representation
     * @returns the ICAL string
     */
    toString(): string {
        if (this.formattedOutputCache === null) {
            this.formattedOutputCache = this.rootComponent.toString();
        }
        return this.formattedOutputCache!;
    }
}