# Command order across node states

`tests/e2e/node-command-order.spec.ts` checks that the same command stands in the same
place in every state of a canvas node.

## Why

A place card listed "show as pin" after "open", while the pin it turns into listed them the
other way round (T-78). Each state was consistent with itself. The unit test of the markup
saw the right DOM order, because the difference was a CSS rule that moved one button to the
corner, and a screenshot only compares a state with its own earlier picture. What a person
compares is the order on the screen.

## What it does

For each surface it collects the visible buttons, reduces each one to the action it performs
(by accessible name, see `PLACE_ACTIONS` and `STORYBOARD_ACTIONS`) and sorts them by the
bounding box: rows top to bottom, a row left to right. It then compares the commands two
states have in common. A command that exists in only one state (the crop tool, the resize
grip) is not compared, but the commands around it must keep their order.

An opacity of zero does not hide a command from the check: a command that fades in on hover
still has its place.

## Node kinds covered

| Kind                                         | States compared                    | Result today                                                       |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `place` (place card, pin)                    | card, pin                          | display toggle, open; same order                                   |
| `place` (map)                                | collapsed toolbar, expanded chrome | lock, open, expand/collapse; same order                            |
| `place` (map)                                | collapsed card, collapsed toolbar  | **differs**, see below                                             |
| `story` (figure card)                        | unselected, selected               | no commands in either state; the test fails if one appears         |
| `storyboard` (note, reference, board, group) | unselected, selected               | open and note-focus keep their order when the resize command joins |

`placeMap` and `placeGround` are registered node types too. They draw the map surface and its
ground without commands of their own; the map's commands live on its card, its toolbar and its
expanded chrome. A "known node kinds" test reads the registrations in the sources and fails
when a kind appears that this file does not account for, so a new node cannot slip in unobserved.

## Known finding: the collapsed map card

The collapsed map card on the canvas lists "expand, open". The toolbar beside the canvas and
the expanded chrome, both drawn by `PlaceMapActions`, list "open, expand". Reordering
`PlaceMapActions` moves the commands of every map toolbar and chrome and with them the
expanded-map baselines of all platforms, which is a design decision and not part of a test
task. The comparison therefore runs under `test.fail()`: it is green while the two orders
differ and turns red the moment they agree, which is the cue to remove the wrapper.

## Proving it

The fix of T-78 is the CSS rule `.place-node__enter:has(+ .place-node__enter)` in
`PlaceNode.css`. With the old selector (`.place-node__enter + .place-node__enter`) restored
and `dist/` rebuilt, the place card test goes red:

```bash
node tools/dev/mutate.mjs packages/client/src/modules/story-world/places/PlaceNode.css \
  --from ".place-node__enter:has(+ .place-node__enter) {" \
  --to ".place-node__enter + .place-node__enter {" \
  -- node <script that runs npm run build, then the spec>
```

The suite runs against the built `dist/`, so the mutation has to rebuild before it runs the
spec, and `dist/` has to be restored afterwards (`git checkout -- dist`).
