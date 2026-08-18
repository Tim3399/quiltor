import { common } from './common';
import { shared } from './shared';
import { shell } from './shell';
import { worlds } from './worlds';
import { manuscript } from './manuscript';
import { figures } from './figures';
import { timeline } from './timeline';
import { tools } from './tools';
import { assistant } from './assistant';
import { places } from './places';
import { writing } from './writing';
import { menus } from './menus';
import { auth } from './auth';

export const de = { ...common, ...shared, ...shell, ...worlds, ...manuscript, ...figures, ...timeline, ...tools, ...assistant, ...places, ...writing, ...menus, ...auth } as const;
