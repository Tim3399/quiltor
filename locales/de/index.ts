import { assistant } from "./assistant";
import { auth } from "./auth";
import { common } from "./common";
import { figures } from "./figures";
import { manuscript } from "./manuscript";
import { menus } from "./menus";
import { places } from "./places";
import { shared } from "./shared";
import { shell } from "./shell";
import { storyboard } from "./storyboard";
import { timeline } from "./timeline";
import { tools } from "./tools";
import { worlds } from "./worlds";
import { writing } from "./writing";

const catalog = {
  ...common,
  ...shared,
  ...shell,
  ...worlds,
  ...manuscript,
  ...figures,
  ...timeline,
  ...tools,
  ...assistant,
  ...places,
  ...writing,
  ...menus,
  ...auth,
  ...storyboard,
} as const;

export { catalog as de };
export default catalog;
