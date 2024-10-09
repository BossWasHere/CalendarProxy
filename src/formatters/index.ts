import { Formatter, CalendarExtensionConfig } from './base.js';
import { DurFormatter } from './dur.js';

export function getFormatter(formatter: string, extensions?: CalendarExtensionConfig): Formatter | undefined {
    let fmtObj: Formatter | undefined;
    switch (formatter) {
        case 'dur':
            fmtObj = new DurFormatter();
            break;
    }

    if (fmtObj && extensions) {
        fmtObj.setExtensions(extensions);
    }

    return fmtObj;
}

export { CalendarExtensionConfig, Formatter, DurFormatter };
