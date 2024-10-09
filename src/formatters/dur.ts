import ical from 'ical.js';

import { CustomEvent } from '../events/event.js';
import { ExtractedDetails, Formatter } from './base.js';

const summarySepRegex = /[\w\d]+:\s((?:\w+\s?)+)\s-\s[\w\s]+/;
const summaryApplyRegex = /([\w\d]+):\s(?:\w+\s?)+\s-\s([\w\s]+)/;
const uidRegex = /^([\w\d]{6}).*/;

/**
 * DurFormatter implementation
 */
export class DurFormatter extends Formatter {
    constructor() {
        super();
        this.replaceProdIdConfig = {
            replacement: '-//CalendarProxy//NONSGML DurTimetable CalendarProxy v1.0//EN'
        };
        this.recurrenceCollapseConfig = {
            requiredMatchingKeys: ['summary', 'location', 'description'],
            frequency: 'weekly'
        };
        this.eventFieldRewriterConfig = {
            patterns: [
                {
                    propertyKey: 'summary',
                    sourceKey: 'summary',
                    useOriginalSourceValue: true,
                    rewriter: {
                        format: src => {
                            const topic = src.replace(summarySepRegex, '$1').split(' ').map(word => word[0]).join('');
                            return src.replace(summaryApplyRegex, `${topic} $2 ($1)`);
                        }
                    }
                }
            ]
        };
        // this.uidFixupConfig = {
        //     fixupFirst: false,
        //     prefix: {
        //         regex: uidRegex,
        //         replacement: '$1_'
        //     },
        //     derivation: 'DTSTART_MD5'
        // };
    }

    getName(): string {
        return 'dur';
    }

    extractDetails(root: ical.Component): ExtractedDetails {
        const anyEvent = root.getFirstSubcomponent('vevent');
        if (!anyEvent) {
            console.warn('No events in original calendar');
            return {
                subject: 'Unknown'
            };
        }

        const uid = anyEvent.getFirstPropertyValue('uid');
        if (typeof uid !== 'string') {
            console.warn('Invalid UID format from original calendar');
            return {
                subject: 'Unknown'
            };
        }

        const subject = uid.replace(uidRegex, '$1');
        return {
            subject
        };
    }

    override getUid(eventView: CustomEvent, details: ExtractedDetails) {
        const data = `${eventView.dtstamp}${eventView.properties.summary}`;
        const hashValue = this.hashContent(data).toUpperCase();
        return `${details.subject}_${hashValue}/CW`;
    }
}
