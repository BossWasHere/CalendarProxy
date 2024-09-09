import { Formatter } from './base.js';

const summarySepRegex = /[\w\d]+:\s((?:\w+\s?)+)\s-\s[\w\s]+/;
const summaryApplyRegex = /([\w\d]+):\s(?:\w+\s?)+\s-\s([\w\s]+)/;
// const uidRegex = /([\w\d]{6}).*/;

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
}
