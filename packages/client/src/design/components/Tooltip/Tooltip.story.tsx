import { Button } from "../../primitives/Button";
import { Tooltip } from "./Tooltip";

export function Default() {
  return (
    <Tooltip content="Die Server-KI steht nur mit Premium-Berechtigung zur Verfügung.">
      {(props) => (
        <Button {...props} appearance="secondary" aria-disabled="true">
          Server-KI
        </Button>
      )}
    </Tooltip>
  );
}
