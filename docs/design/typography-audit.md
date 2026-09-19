# Typography role audit

Status: the inventory below preserves the pre-migration evidence. The approved C3 follow-up
resolves its work-content concerns and the previously pending contextual decisions; see the
[follow-up review](followup-review-2026-09-12.md). Legacy body/section-title aliases have been removed.

## Scope and method

This is the Stage C1 inventory requested by `ai/plans/frontend-styleguide-adoption.md`. It records
every CSS reference to `--font-size-1` (9px) and `--font-size-2` (10px) below
`packages/client/src` in the pre-C2 source captured on 12 September 2026. The inventory was generated
from all CSS references, then each selector was checked against its CSS block and the TSX that
renders or composes it. It therefore includes `font` shorthands as well as `font-size` declarations.

There are **138 references in 55 CSS files**: 46 to `--font-size-1` and 92 to
`--font-size-2`. Ten references are below `design/`, one is in `app/`, and 127 are in feature
modules. `--font-size-1`, `--font-size-2`, `--ui`, and `--prose` are declared only in the unthemed
`:root` block in `design/tokens.css`; no theme selector changes font size or family. Accordingly,
“UI / invariant” below means the effective Inter/system sans stack and no light/dark dependence;
“prose / invariant” means the EB Garamond/Iowan/Georgia serif stack and no theme dependence.

The category is the content's actual purpose, not the element name. “Work content” is prose or
domain data an author is inspecting or editing. “Control” is interactive text. “Label” names a
field, group, kind, or section. “Metadata” qualifies other content or reports status. “Numeric” is
a count, date, duration, distance, coordinate, or statistic. `!` marks a migration concern.

## Complete 9px and 10px inventory

Paths in the tables are relative to `packages/client/src/`.

### Application and design system

| Owner                                                        | Selector                                | Size | Category → role  | Verified content                         | Family/theme   | Concern                                     |
| ------------------------------------------------------------ | --------------------------------------- | ---: | ---------------- | ---------------------------------------- | -------------- | ------------------------------------------- |
| `app/AppShell.css:47`                                        | `.brand small`                          |   10 | metadata         | Product strapline under the brand        | UI / invariant | —                                           |
| `design/base.css:47`                                         | `kbd`                                   |   10 | control          | Keyboard shortcut key                    | UI / invariant | Public global owner                         |
| `design/typography.css:9`                                    | `.section-label`                        |   10 | label            | Shared uppercase section label           | UI / invariant | Public global owner                         |
| `design/testing/gallery/DesignGallery.css:46`                | `.design-gallery__header p`             |   10 | label            | Gallery eyebrow                          | UI / invariant | Test gallery only                           |
| `design/testing/gallery/DesignGallery.css:110`               | `.design-gallery__stories span, … code` |   10 | metadata         | Story name and source identifier         | UI / invariant | Test gallery only                           |
| `design/primitives/Field/Field.css:8`                        | `.ui-field__label`                      |   10 | label            | Required public `Field.label`            | UI / invariant | ! Public API has no typography role/variant |
| `design/patterns/SelectableRow/SelectableRow.css:32`         | `.selectable-row__metadata`             |   10 | metadata         | Optional row metadata slot               | UI / invariant | Public owner                                |
| `design/patterns/DropdownMenu/DropdownMenu.css:23`           | `.ui-dropdown-menu__footer`             |   10 | metadata         | Optional menu help/footer                | UI / invariant | Public owner                                |
| `design/components/WorkspaceToolbar/WorkspaceToolbar.css:42` | `.workspace-toolbar__title span`        |   10 | metadata         | Optional context beside toolbar title    | UI / invariant | Public owner                                |
| `design/components/SidePanel/SidePanel.css:33`               | `.side-panel__header`                   |   10 | label            | Public panel section title               | UI / invariant | ! Same raw size as metadata owners          |
| `design/components/StatusBar/StatusBar.css:13`               | `.status-bar`                           |   10 | metadata/numeric | Status items, counts, and shortcut hints | UI / invariant | ! Public owner combines roles               |

### Assistant, history, notes, graph, and storyboard

| Owner                                             | Selector                                        | Size | Category → role | Verified content                       | Family/theme   | Concern                                                 |
| ------------------------------------------------- | ----------------------------------------------- | ---: | --------------- | -------------------------------------- | -------------- | ------------------------------------------------------- |
| `modules/assistant/AssistantComposer.css:11`      | `.assistant-chapter-picker`                     |   10 | label           | Chapter-context field wrapper          | UI / invariant | —                                                       |
| `modules/assistant/AssistantComposer.css:16`      | `.assistant-chapter-picker-trigger`             |   10 | control         | Current chapter picker button          | UI / invariant | —                                                       |
| `modules/assistant/AssistantComposer.css:34`      | `.assistant-chapter-option`                     |   10 | control         | Chapter option                         | UI / invariant | —                                                       |
| `modules/assistant/AssistantComposer.css:54`      | `.assistant-drawer > footer > small`            |    9 | metadata        | Composer capability/privacy hint       | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:41`  | `.assistant-context-notice`                     |    9 | metadata        | Active context notice                  | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:65`  | `.assistant-source-chip__context`               |    9 | metadata        | Source context inside a chip           | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:92`  | `.assistant-proposal-group > header`            |   10 | label           | Proposal group heading                 | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:97`  | `.assistant-proposal-heading`                   |   10 | label           | Proposal table/header row              | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:107` | `.assistant-proposal`                           |   10 | work content    | Proposed manuscript/world edit         | UI / invariant | ! Work content at metadata size                         |
| `modules/assistant/AssistantConversation.css:128` | `.assistant-proposal-content > small`           |    9 | metadata        | Proposal qualification                 | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:139` | `.assistant-claim-review > span`                |    9 | label           | Claim-review state label               | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:145` | `.assistant-claim-review > small`               |    9 | metadata        | Claim-review explanation               | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:163` | `.assistant-thinking`                           |   10 | metadata        | In-progress assistant status           | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:204` | `.assistant-trace`                              |   10 | control         | Expandable trace summary               | UI / invariant | —                                                       |
| `modules/assistant/AssistantConversation.css:213` | `.assistant-trace pre`                          |    9 | work content    | Technical trace output used for review | UI / invariant | ! Work content at metadata size; no mono family         |
| `modules/assistant/AssistantConversation.css:229` | `.assistant-edit-field > span`                  |   10 | label           | Proposed-edit field label              | UI / invariant | —                                                       |
| `modules/assistant/AssistantDrawer.css:55`        | `.assistant-drawer > header small`              |    9 | metadata        | Drawer scope/subtitle                  | UI / invariant | —                                                       |
| `modules/assistant/AssistantDrawer.css:71`        | `.assistant-world-update > small`               |    9 | metadata        | World-update explanation               | UI / invariant | —                                                       |
| `modules/assistant/AssistantStatusPanel.css:18`   | `.assistant-scope strong`                       |   10 | label           | Current assistant scope name           | UI / invariant | —                                                       |
| `modules/assistant/AssistantStatusPanel.css:22`   | `.assistant-scope small`                        |    9 | metadata        | Scope detail                           | UI / invariant | —                                                       |
| `modules/assistant/AssistantStatusPanel.css:29`   | `.assistant-offline p`                          |   10 | metadata        | Offline explanation/status             | UI / invariant | —                                                       |
| `modules/history/HistoryDialog.css:48`            | `.history-layout nav small`                     |    9 | metadata        | Commit hash and date                   | UI / invariant | —                                                       |
| `modules/history/HistoryDialog.css:57`            | `.diff-view`                                    |   10 | work content    | Unified manuscript/project diff        | UI / invariant | ! Work content at metadata size; proportional UI family |
| `modules/history/HistoryDialog.css:107`           | `.diff-kind`                                    |    9 | label           | Changed-object kind badge              | UI / invariant | —                                                       |
| `modules/history/HistoryDialog.css:121`           | `.diff-stat`                                    |    9 | numeric         | Added/removed word or line counts      | UI / invariant | —                                                       |
| `modules/history/SnapshotDialog.css:11`           | `.utility-disclosure > summary`                 |   10 | control         | Technical-details disclosure           | UI / invariant | —                                                       |
| `modules/history/SnapshotDialog.css:33`           | `.snapshot-facts dt`                            |    9 | label           | Snapshot fact name                     | UI / invariant | —                                                       |
| `modules/history/SnapshotDialog.css:53`           | `.changed-files code`                           |   10 | work content    | Changed file path                      | UI / invariant | ! Review content at metadata size; no mono family       |
| `modules/history/SnapshotDialog.css:61`           | `.snapshot-output`                              |   10 | work content    | Backup/snapshot command output         | UI / invariant | ! Work output at metadata size; no mono family          |
| `modules/notes/NoteEditor.css:210`                | `.note-reference-option__copy small, …empty`    |   10 | metadata        | Reference detail or empty result       | UI / invariant | —                                                       |
| `modules/graph/GraphEdgeAppearanceSelect.css:17`  | `.graph-edge-appearance-select__label`          |   10 | label           | Edge appearance field label            | UI / invariant | —                                                       |
| `modules/graph/GraphEdgeInspector.css:40`         | `.graph-edge-inspector__endpoints`              |   10 | metadata        | Relationship endpoint names            | UI / invariant | —                                                       |
| `modules/graph/GraphEdgeInspector.css:58`         | `.graph-edge-inspector__reverse small`          |    9 | metadata        | Reverse-direction explanation          | UI / invariant | —                                                       |
| `modules/graph/GraphRelationshipEdge.css:20`      | `.graph-edge-label`                             |   10 | work content    | Authored relationship label on graph   | UI / invariant | ! Work content at metadata size                         |
| `modules/storyboard/StoryboardWorkspace.css:75`   | `.storyboard-library__heading small`            |   10 | metadata        | Library section context/count          | UI / invariant | —                                                       |
| `modules/storyboard/StoryboardWorkspace.css:131`  | `.storyboard-search-result__copy small, …empty` |   10 | metadata        | Search result detail or empty result   | UI / invariant | —                                                       |
| `modules/storyboard/StoryboardNode.css:69`        | `.storyboard-node__kind`                        |   10 | label           | Storyboard card kind                   | UI / invariant | —                                                       |

### Manuscript workspace

| Owner                                             | Selector                             | Size | Category → role | Verified content                              | Family/theme   | Concern                                  |
| ------------------------------------------------- | ------------------------------------ | ---: | --------------- | --------------------------------------------- | -------------- | ---------------------------------------- |
| `modules/manuscript/ChapterActionsMenu.css:23`    | `.binder-chapter-menu-header > span` |    9 | label           | Chapter action-menu heading                   | UI / invariant | —                                        |
| `modules/manuscript/ChapterBinder.css:104`        | `.chapter-meta`                      |   10 | metadata        | Chapter status/count detail                   | UI / invariant | —                                        |
| `modules/manuscript/ChapterBinder.css:177`        | `.binder-story-time-title`           |   10 | label           | Story-time section label                      | UI / invariant | —                                        |
| `modules/manuscript/ChapterBinder.css:185`        | `.binder-story-time-value`           |   10 | numeric         | Chapter story-time value                      | UI / invariant | —                                        |
| `modules/manuscript/ChapterBinder.css:215`        | `.binder-story-time-help, …status`   |   10 | metadata        | Story-time help or validation status          | UI / invariant | —                                        |
| `modules/manuscript/ChapterBinder.css:233`        | `.binder-story-time-field > span`    |   10 | label           | Story-time field label                        | UI / invariant | —                                        |
| `modules/manuscript/ChapterFolderTree.css:158`    | `.binder-folder-count`               |   10 | numeric         | Chapters in folder                            | UI / invariant | —                                        |
| `modules/manuscript/ChapterFolderTree.css:241`    | `.binder-folder-empty`               |   10 | metadata        | Empty-folder status                           | UI / invariant | —                                        |
| `modules/manuscript/ChapterFolderTree.css:267`    | `.binder-root-drop`                  |   10 | control         | Root drag/drop target instruction             | UI / invariant | —                                        |
| `modules/manuscript/ChapterHistoryPanel.css:7`    | `.chapter-version-diff__legend`      |    9 | label           | Version diff legend                           | UI / invariant | —                                        |
| `modules/manuscript/ChapterHistoryPanel.css:37`   | `.chapter-version-diff__status`      |    9 | metadata        | Version comparison status                     | UI / invariant | —                                        |
| `modules/manuscript/ChapterTurnAffordance.css:58` | `.chapter-turn__copy > span`         |    9 | label           | Chapter-turn action caption                   | UI / invariant | —                                        |
| `modules/manuscript/ChapterTurnAffordance.css:73` | `.chapter-turn__copy > small`        |    9 | metadata        | Chapter-turn explanation                      | UI / invariant | —                                        |
| `modules/manuscript/EditorSurface.css:119`        | `.chapter-history__title > small`    |   10 | metadata        | Version title/date qualifier                  | UI / invariant | Prose applies only to its sibling title  |
| `modules/manuscript/EditorSurface.css:166`        | `.word-completion`                   |   10 | control         | Inline completion candidate                   | UI / invariant | Explicit UI shorthand                    |
| `modules/manuscript/EditorSurface.css:256`        | `.text-search-navigation`            |   10 | control         | Search match navigation                       | UI / invariant | —                                        |
| `modules/manuscript/EntityMentionCard.css:27`     | `.entity-mention-card__kind`         |    9 | label           | Entity kind                                   | UI / invariant | —                                        |
| `modules/manuscript/EntityMentionCard.css:49`     | `.entity-mention-card__detail`       |   10 | metadata        | Mention/entity detail                         | UI / invariant | —                                        |
| `modules/manuscript/FocusPanels.css:94`           | `.focus-helper-panel h3`             |    9 | label           | Helper panel section heading                  | UI / invariant | ! Section title at metadata size         |
| `modules/manuscript/FocusPanels.css:191`          | `.focus-chapter-row__number`         |   10 | numeric         | Chapter ordinal                               | UI / invariant | —                                        |
| `modules/manuscript/FocusPanels.css:210`          | `.focus-chapter-row__copy small`     |   10 | metadata        | Chapter row detail                            | UI / invariant | —                                        |
| `modules/manuscript/FocusPanels.css:265`          | `.focus-helper-chip`                 |   10 | control         | Compact helper action on narrow screens       | UI / invariant | Responsive override                      |
| `modules/manuscript/FocusPanels.css:268`          | `.focus-helper-panel h3`             |    9 | label           | Same helper section heading on narrow screens | UI / invariant | ! Duplicate responsive section-title use |
| `modules/manuscript/ManuscriptToolbar.css:34`     | `.text-workspace …stats dd`          |   10 | numeric         | Word/character statistic value                | UI / invariant | —                                        |
| `modules/manuscript/ManuscriptToolbar.css:39`     | `.text-workspace …stats dt`          |    9 | label           | Statistic name                                | UI / invariant | —                                        |
| `modules/manuscript/WritingAidInspector.css:4`    | `.helper-panel h3`                   |   10 | label           | Writing-aid section heading                   | UI / invariant | ! Section title at metadata size         |
| `modules/manuscript/WritingAidInspector.css:211`  | `.writing-apply-hint`                |   10 | metadata        | Apply-result hint                             | UI / invariant | —                                        |
| `modules/manuscript/WritingAidInspector.css:243`  | `.writing-result__part-of-speech`    |   10 | label           | Part-of-speech label                          | UI / invariant | —                                        |
| `modules/manuscript/WritingAidInspector.css:279`  | `.writing-attribution`               |    9 | metadata        | Result/provider attribution                   | UI / invariant | —                                        |
| `modules/manuscript/WritingAidInspector.css:296`  | `.grammar-status`                    |   10 | metadata        | Grammar check status                          | UI / invariant | —                                        |
| `modules/manuscript/WritingAidInspector.css:352`  | `.text-action`                       |   10 | control         | Inline writing action                         | UI / invariant | —                                        |

The chapter history comparison itself is not a small-size occurrence: `.historical-prose` in
`EditorSurface.css` is 16px prose (`--font-size-5`, `--prose`). This makes the 10px UI-family
`.diff-view` an explicit cross-view inconsistency for the same task.

### Story world: figures and shared graph

| Owner                                                       | Selector                                                | Size | Category → role | Verified content                  | Family/theme   | Concern                             |
| ----------------------------------------------------------- | ------------------------------------------------------- | ---: | --------------- | --------------------------------- | -------------- | ----------------------------------- |
| `modules/story-world/StoryGraph.css:114`                    | `.story-node .node-kind`                                |    9 | label           | Graph node kind                   | UI / invariant | —                                   |
| `modules/story-world/StoryGraph.css:155`                    | `.react-flow__edge-text`                                |   10 | work content    | Authored relationship text        | UI / invariant | ! Work content at metadata size     |
| `modules/story-world/figures/FigureBacklinksSection.css:20` | `.figure-profile-backlinks-empty`                       |   10 | metadata        | Empty backlinks status            | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureCanvas.css:103`          | `.figure-workspace .node-guests`                        |   10 | work content    | Guest figure names on a node      | UI / invariant | ! Work content at metadata size     |
| `modules/story-world/figures/FigureInspector.css:71`        | `.alias-heading p`                                      |    9 | metadata        | Alias section explanation         | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureInspector.css:84`        | `.alias-add`                                            |    9 | control         | Add-alias action                  | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureInspector.css:139`       | `.alias-input-wrap > small`                             |    9 | metadata        | Alias input help                  | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureInspector.css:150`       | `.alias-error`                                          |    9 | metadata        | Alias validation error            | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureInspector.css:192`       | `.figure-profile-fields-heading p`                      |    9 | metadata        | Profile-fields explanation        | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/FigureInspector.css:249`       | `.figure-card-select-field > span`                      |   10 | label           | Figure-card select label          | UI / invariant | —                                   |
| `modules/story-world/figures/FigureInspector.css:266`       | `.relationship-heading > small`                         |    9 | metadata        | Relationship count/context        | UI / invariant | —                                   |
| `modules/story-world/figures/FigureInspector.css:353`       | `.figure-inspector …editor > small`                     |   10 | metadata        | Relationship label-editor help    | UI / invariant | Explicit UI shorthand               |
| `modules/story-world/figures/PresenceField.css:25`          | `.presence-journey-stop`                                |   10 | work content    | Authored presence journey stop    | UI / invariant | ! Domain content at metadata size   |
| `modules/story-world/figures/PresenceField.css:37`          | `.presence-journey-duration`                            |   10 | numeric         | Journey duration                  | UI / invariant | —                                   |
| `modules/story-world/figures/TimelineStrip.css:49`          | `.timeline-heading > span`                              |   10 | label           | Timeline strip heading            | UI / invariant | —                                   |
| `modules/story-world/figures/TimelineStrip.css:60`          | `.timeline-heading-action`                              |   10 | control         | Heading action                    | UI / invariant | —                                   |
| `modules/story-world/figures/TimelineStrip.css:111`         | `.timeline-moment > span`                               |    9 | numeric         | Moment date/index                 | UI / invariant | —                                   |
| `modules/story-world/figures/TimelineStrip.css:141`         | `.timeline-moment-copy b`                               |   10 | work content    | Authored moment title             | UI / invariant | ! Work content at metadata size     |
| `modules/story-world/figures/TimelineStrip.css:146`         | `.timeline-moment-copy small`                           |    9 | metadata        | Moment detail                     | UI / invariant | —                                   |
| `modules/story-world/figures/TimelineStrip.css:169`         | `.timeline-strip .timeline-title, …date, …detail-input` |   10 | control         | Timeline title/date/detail inputs | UI / invariant | Deliberate compact control override |
| `modules/story-world/figures/TimelineStrip.css:216`         | `.timeline-detail-field > label`                        |    9 | label           | Timeline detail field label       | UI / invariant | —                                   |
| `modules/story-world/figures/WorldOverviewPanel.css:49`     | `.world-overview__group-title > small`                  |   10 | numeric         | Group count                       | UI / invariant | Explicit UI family                  |
| `modules/story-world/figures/WorldOverviewPanel.css:70`     | `.world-overview__footer`                               |   10 | metadata        | Overview footer/help              | UI / invariant | —                                   |

### Story world: timeline

| Owner                                                        | Selector                                | Size | Category → role | Verified content                | Family/theme   | Concern                                 |
| ------------------------------------------------------------ | --------------------------------------- | ---: | --------------- | ------------------------------- | -------------- | --------------------------------------- |
| `modules/story-world/timeline/CustomCalendarSettings.css:26` | `.timeline-calendar-item-head`          |    9 | label           | Custom calendar item heading    | UI / invariant | —                                       |
| `modules/story-world/timeline/MomentBoard.css:67`            | `.story-moment-index`                   |   10 | numeric         | Moment ordinal                  | UI / invariant | —                                       |
| `modules/story-world/timeline/MomentBoard.css:79`            | `.story-moment-content > small`         |    9 | metadata        | Moment timing/detail            | UI / invariant | Prose applies only to its sibling title |
| `modules/story-world/timeline/MomentHeader.css:31`           | `.storyboard-title > span, … > small`   |   10 | label/metadata  | Timeline eyebrow and context    | UI / invariant | One declaration spans two roles         |
| `modules/story-world/timeline/MomentTimeFields.css:13`       | `.timeline-calendar-date > legend`      |   10 | label           | Calendar date group label       | UI / invariant | —                                       |
| `modules/story-world/timeline/MomentTimeFields.css:20`       | `.calendar-coordinate-field`            |   10 | control         | Calendar coordinate input       | UI / invariant | —                                       |
| `modules/story-world/timeline/MomentTimeFields.css:54`       | `.timeline-relative-position > p`       |   10 | metadata        | Relative-position explanation   | UI / invariant | —                                       |
| `modules/story-world/timeline/MomentTimeFields.css:61`       | `.timeline-relative-position > …field`  |   10 | control/numeric | Relative position value/control | UI / invariant | —                                       |
| `modules/story-world/timeline/PresenceBoard.css:39`          | `.presence-chip small`                  |    9 | metadata        | Presence chip timing/detail     | UI / invariant | —                                       |
| `modules/story-world/timeline/PresenceBoard.css:85`          | `.presence-chip-mini`                   |   10 | metadata        | Compact presence summary        | UI / invariant | —                                       |
| `modules/story-world/timeline/PresenceBoard.css:90`          | `.presence-lane-empty`                  |   10 | metadata        | Empty lane status               | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:34`      | `.state-change-mode-row > span`         |   10 | label           | State-change mode label         | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:105`     | `.timeline-manager-section header p`    |   10 | metadata        | Manager section explanation     | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:188`     | `.change-badge`                         |    9 | label           | Change kind badge               | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:217`     | `.state-change-inspector > header span` |    9 | metadata        | Inspector header context/count  | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:306`     | `.life-event-roster small`              |    9 | metadata        | Life-event roster detail        | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:341`     | `.death-dropzone small`                 |   10 | control         | Drop-zone instruction           | UI / invariant | —                                       |
| `modules/story-world/timeline/StateChangePanels.css:375`     | `.life-change-list small`               |    9 | metadata        | Life-change detail              | UI / invariant | —                                       |
| `modules/story-world/timeline/TimeSystemControls.css:14`     | `.timeline-time-settings-trigger`       |   10 | control         | Time settings button            | UI / invariant | —                                       |
| `modules/story-world/timeline/TimeSystemControls.css:30`     | `.timeline-time-setting-field`          |   10 | label/control   | Time setting field and label    | UI / invariant | One declaration spans roles             |

### Story world: places and world gate

| Owner                                                       | Selector                            | Size | Category → role | Verified content                 | Family/theme      | Concern                                     |
| ----------------------------------------------------------- | ----------------------------------- | ---: | --------------- | -------------------------------- | ----------------- | ------------------------------------------- |
| `modules/story-world/worlds/WorldGate.css:44`               | `.world-gate header small`          |   10 | metadata        | World-gate eyebrow/subtitle      | UI / invariant    | Prose applies only to the mark and headings |
| `modules/story-world/places/PlaceInspector.css:67`          | `.places-section-heading p`         |   10 | metadata        | Place section explanation        | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceInspector.css:105`         | `.places-stay-duration`             |   10 | numeric         | Stay duration                    | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceInspector.css:119`         | `.places-stay-range`                |   10 | numeric         | Stay date range                  | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceInspector.css:177`         | `.places-chronicle-list small`      |   10 | metadata        | Chronicle entry date/detail      | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceLevelTrail.css:25`         | `.place-level-trail__step`          |   10 | control         | Place-level breadcrumb           | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceLevelTrail.css:62`         | `.place-level-trail__scale`         |    9 | numeric         | Current map scale/unit           | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapChrome.css:69`          | `.place-map-chrome__context`        |   10 | metadata        | Current map/place context        | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapChrome.css:112`         | `.place-map-chrome__label`          |    9 | label           | Map chrome control label         | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapChrome.css:160`         | `.place-map-chrome__scale-distance` |   10 | numeric         | Scale distance                   | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapScaleControl.css:16`    | `.place-map-scale-control__per`     |   10 | label/numeric   | “per” unit relationship          | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapSection.css:15`         | `.place-map-section__title`         |    9 | label           | Map section title                | UI / invariant    | ! Section title at metadata size            |
| `modules/story-world/places/PlaceMapSection.css:43`         | `.place-map-section__hint`          |   10 | metadata        | Map section instruction          | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMapToolbar.css:25`         | `.place-map-toolbar__name`          |   10 | work content    | Current authored place/map name  | prose / invariant | ! Work title at metadata size               |
| `modules/story-world/places/PlaceMapToolbar.css:36`         | `.place-map-toolbar__measure`       |    9 | numeric         | Live measurement                 | UI / invariant    | —                                           |
| `modules/story-world/places/PlaceMeasurementOverlay.css:22` | `.places-scale-value-group, …field` |   10 | control/numeric | Measurement scale value and unit | UI / invariant    | One declaration spans roles                 |

## Findings

The most serious semantic mismatches are the general history diff, backup/snapshot output, assistant
proposal/trace content, authored graph relationship labels, node guest names, timeline moment titles,
presence journey stops, and the current place/map name. These are work content at 9–10px. Several
technical outputs also use the proportional UI stack because no monospace family exists. The history
dialog is especially inconsistent: the same version-comparison task is 10px UI there and 16px prose
in the chapter history panel.

`Field` confirms the public-contract problem identified in the plan. Its required `label` always
renders as `.ui-field__label`; `FieldProps` exposes content and visibility/association behavior but
no semantic typography choice. `SidePanelHeader` similarly fixes a section title to the same 10px
raw source used by `SelectableRow` metadata, `WorkspaceToolbar` context, `DropdownMenu` help, and
`StatusBar`. Those owners may intentionally preserve 10px in the first migration, but their public
roles are different and should no longer share an unnamed numeric dependency.

Three feature selectors style actual section headings at metadata sizes: `.focus-helper-panel h3`,
`.helper-panel h3`, and `.place-map-section__title`. Their first migration must name them as section
titles while retaining 9/10px; value review belongs to C3.

No typography property is theme-dependent today. Colour frequently is, but that does not make the
font role theme-dependent.

## Recommended semantic contract for C2

Keep `--font-size-*` as private numeric sources and add one role matrix with these seven base names:
`page-title`, `section-title`, `body`, `control`, `label`, `metadata`, and `numeric`. The first layer
should name size ownership while resolving to current scale values. Family, weight, line height, and
tracking remain explicit component-context declarations during this migration; they should move into
shared recipes only after a separate audit proves that the complete recipes match.

Only these variants are justified by current content and density:

| Role            | Variants justified now                                                           | First-migration mapping                                                                             |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `page-title`    | `display` for gate/editor hero titles                                            | Preserve current display tokens and prose family                                                    |
| `section-title` | `compact` for dense inspector/panel headings                                     | Preserve 9/10/12px compact uses and 18px standard uses                                              |
| `body`          | Reading/emphasis contexts; legacy micro/compact only as temporary audited states | Preserve current sizes; map flagged 9/10px work content to legacy body roles for explicit C3 review |
| `control`       | `compact` and standard                                                           | Preserve 9/10px compact controls and 12px standard controls                                         |
| `label`         | `compact` and standard                                                           | Preserve 9px and 10px labels separately                                                             |
| `metadata`      | `compact` and standard                                                           | Preserve 9px and 10px metadata separately                                                           |
| `numeric`       | `compact` and standard                                                           | Preserve 9px and 10px numbers; add tabular figures where columns or changing widths need alignment  |

Do not encode feature names, individual components, light/dark themes, or raw scale numbers into role
names. A code context has a real family requirement, not a synonym for “small.” The shared `--mono`
stack is justified for diffs, file paths, and trace/output blocks, but family changes require a
separate browser review.

The C2 migration should classify by the table above rather than perform a token-wide substitution:
one `--font-size-2` reference currently means a label, metadata, control, numeric datum, section
title, or work content. A mechanical `--font-size-2` → single semantic alias would preserve the
ambiguity.

The repository owner selected the first C3 outcomes for comparison content: manuscript diffs move to
16px prose, while technical diffs move to 14px monospace. Other typography values stay unchanged.

## Migration disposition

C2 introduced size aliases in `design/tokens.css` for all seven families and migrated all screen
typography declarations away from direct `--font-size-1` through `--font-size-8` consumption.
`legacy-micro` and `legacy-compact` make retained 9px and 10px debt searchable without changing it.
No role alias is theme-dependent, and every declared role has a current consumer.

The role migration changed 227 declarations in 67 owned CSS files. A pre-migration snapshot covered
109 non-token stylesheets outside the separately owned `HistoryDialog.css`; resolving every new role
alias back to its numeric source produced identical typography declarations for every selector in all
109 files. This verifies that C2 preserved size, family, shorthand weight, line height, and tracking.
A focused contract test also resolves the complete role graph, requires every family, rejects unused
aliases, and prevents public design owners from returning to direct numeric font-size declarations.

The separately reviewed C3 history change uses `body` (14px) with `--mono` for technical diffs and
`body-emphasis` (16px) with `--prose` for manuscript/profile diffs. Other values remain at their
pre-migration sizes. The small work-content findings elsewhere remain visible through legacy body
roles for later, location-specific C3 decisions.

## Pre-migration remaining scale inventory

| Source                    | References | Notes                                                   |
| ------------------------- | ---------: | ------------------------------------------------------- |
| `--font-size-1`           |         46 | Fully classified above                                  |
| `--font-size-2`           |         92 | Fully classified above                                  |
| `--font-size-3`           |         49 | Mostly standard controls, labels, and compact body text |
| `--font-size-4`           |         22 | Default UI body plus prose/control uses                 |
| `--font-size-5`           |         36 | Prose/body and smaller titles                           |
| `--font-size-6`           |         14 | Predominantly section titles and reading text           |
| `--font-size-7`           |          5 | Large headings                                          |
| `--font-size-8`           |          3 | Page/display headings                                   |
| Named display sizes       |          4 | `display-sm` ×2, `display-lg` ×1, `display-xl` ×1       |
| Named prose heading sizes |          3 | One use each of heading levels 1–3 in `NoteEditor.css`  |

Additional non-scale sizing is intentionally contextual: `PrintDocument.css` has ten print-only
`pt`/`em` declarations; `StoryGraph.css` consumes the zoom-dependent
`--node-compact-font-size`; `PlaceNode.css` consumes the runtime-scaled `--place-pin-font`; and
`MomentHeader.css` uses `font-size: 0` to suppress layout text in a responsive presentation. C2 kept
these print and zoom/runtime values context-owned rather than forcing them into screen-density
aliases.
