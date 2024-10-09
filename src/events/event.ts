export interface EventPredicate {
    /**
     * How to check this predicate applies.
     */
    match:
    | 'any'
    | 'all'
    | number;
    /**
     * Property key to check.
     */
    propertyKey: string;
    /**
     * Method to use to check the property.
     */
    method:
    | {
        /**
         * Type of comparison to use.
         */
        type: "equals" | "contains" | "startsWith" | "endsWith";
        /**
         * Whether to ignore case.
         */
        ignoreCase?: boolean;
        /**
         * Value to compare against.
         */
        value: string;
    }
    | {
        /**
         * Type of comparison to use.
         */
        type: "regex";
        /**
         * Regular expression to use.
         */
        value: string;
    };
}

/**
 * Represents a custom event that can be added to a calendar.
 */
export interface CustomEvent {
    /**
     * Timestamp of event creation.
     */
    dtstamp: string;
    /**
     * Timestamp of event start.
     */
    dtstart: string;
    /**
     * Timestamp of event end.
     */
    dtend: string;
    /**
     * Timezone ID of the event.
     */
    tzid?: string;
    /**
     * All other properties of the event.
     */
    properties: Record<string, string>;
    /**
     * Conditions that must be met for the event to be added to the calendar.
     */
    conditions: EventPredicate[];
}
