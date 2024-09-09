import { Formatter } from './base.js';
import { DurFormatter } from './dur.js';

export function getFormatter(formatter: string): Formatter | undefined {
    switch (formatter) {
        case 'dur':
            return new DurFormatter();
    }
}

export { Formatter, DurFormatter };
