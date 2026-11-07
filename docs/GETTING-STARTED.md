# Your first steps with Quiltor

Writing locally needs neither a cloud account nor an AI model.
A "world" is your project: manuscript, characters, places and planning belong together.

## Install and open

The direct desktop packages support Windows x86_64 and macOS on Apple Silicon. Pick the
package for your version from the [published packages](https://github.com/Tim3399/quiltor/releases).
Not every pre-release includes finished installers.

1. **Windows:** Open `Quiltor-Setup-<version>.exe`, follow the installation steps
   and then start Quiltor from the Start menu.
2. **macOS on Apple Silicon:** Open the matching `.dmg`, copy Quiltor into
   "Applications" and start it there.
3. Leave **Cloud backup (optional)** empty unless you have set up a compatible
   backup service of your own.
4. Open a world or choose **New world**, enter a title and choose
   **Create world**. No AI setup is needed for this.

If there is no matching desktop package, the
[technical quick start](../README.en.md#quick-start) describes running Quiltor locally in the browser.
This guide promises no store, mobile or Linux desktop edition.
On a hosted website, the project data lives on that website's server.

## Sync a project with the cloud

When a compatible cloud target is set up, open **More → Versions & backups** in your project
and there the **Sync with other devices** tab. Sign in to the target if needed and then choose
**Refresh status**. **Sync now** starts a single sync.
Nothing is transferred automatically in the background.

On another device, you can open an existing cloud project by restoring it from the backup
service. At the first sync you review both versions and choose explicitly which one to keep.
The same applies when both device versions have changed, for example when a chapter was
deleted on one device and edited offline on the other. Earlier states remain as backups.
After you take over a cloud version, Quiltor asks you to reload.

The dialog shows the last confirmed sync and the reported storage quota.
A read-only account can still retrieve existing cloud states. If a deletion date is shown,
use it to save the cloud copies you need locally beforehand. Binding periods and services
are set by the operator. Local writing, the trash and project export stay available without
cloud access.

The chapter trash and set-aside chapters are transferred as well. Deleting a whole local
project does not delete any cloud backups. Several texts are never merged automatically;
check the complete project state before you choose.

## Start with a task

| Task                    | Where to start                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write                   | Open **Manuscript**, choose **New chapter** and start in the chapter text.                                                                                                                                                                              |
| Bring in existing text  | Create a chapter and paste your text from your previous application. Check paragraphs, formatting and links. Bring in longer texts chapter by chapter. For a complete Quiltor project, choose **Import** and then **Project** in the project selection. |
| Look up a character     | Open **Search & commands**, search for the name and open the result. **Manuscript** takes you back to the chapter you edited last.                                                                                                                      |
| Prepare world knowledge | Open the assistant and explicitly select the chapters to consider. Set up the local model only for this feature, and review proposals before you accept them.                                                                                           |

The assistant does not write or revise novel prose. Standard analyses consider chapters
in the book. Set-aside chapters can be selected explicitly; deleted chapters are excluded.

## Keep drafts and get deleted things back

**Remove from book** sets a chapter aside. Its text, notes and references are kept.
The **Set aside** filter finds it again; the book view, book length and book export leave it
out. **Return to book** puts the same chapter back.

| Content                        | Deletion and restore rule                                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chapter                        | **Delete chapter** moves it into the labelled **Trash** of the chapter navigation. Search for a title or text there, check the preview and choose **Restore chapter**. Its book status is kept. If the original folder is gone, the top level is named as the target. |
| Chapter folder                 | Its contents are kept and move to the level above.                                                                                                                                                                                                                    |
| Whole world                    | Trash in the world selection; restoring it keeps local backups and history.                                                                                                                                                                                           |
| World elements and storyboards | No trash of their own yet. Use undo right away, or an earlier backup. Missing reference targets are marked.                                                                                                                                                           |
| Storyboard reference card      | Removes only the card, not the original chapter or world element.                                                                                                                                                                                                     |

The trash does not empty itself. **Delete permanently** is a separate confirmed action. It does
not delete copies on a separately operated backup server.

## Tell export, transfer and backup apart

| Feature                 | Scope                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export book             | The current book version, without set-aside and deleted chapters.                                                                                                                                                                      |
| Export / import project | The current project as `.quiltor`, including set-aside chapters, the chapter trash and required images. Without version history and earlier backups. Import creates a new world; accounts and backup credentials are not carried over. |
| Restore backup          | In the **Automatic backups** tab: preview a local backup; before it replaces anything, the current saved state is backed up once more. The dialog shows the storage location and the last local backup.                                |
| Keep a version          | A named state in the **Versions** tab under More → Versions & backups; it stays on the device.                                                                                                                                         |

When **Save failed** appears, your draft stays in the editor. **Rescue draft** lets you copy
and download it. The additional JSON rescue contains the loaded project documents, but no image
files or earlier backups. It is not a complete project transfer.

With competing sessions you can compare the saved version. Save both versions before you
explicitly continue with one of them. Do not reload the browser hastily.

Local writing and local rescue paths need no cloud subscription. An outage of the remote
backup does not lock them. Automatic synchronization between devices is not offered at present.

## Keyboard controls

| Shortcut                         | Action                       |
| -------------------------------- | ---------------------------- |
| `Cmd/Ctrl + S`                   | Save immediately             |
| `Cmd/Ctrl + Shift + S`           | Open backup dialog           |
| `Cmd/Ctrl + F` or `Cmd/Ctrl + K` | Search & commands            |
| `Cmd/Ctrl + Z`                   | Undo                         |
| `Cmd/Ctrl + Shift + Z`           | Redo                         |
| `Esc`                            | Leave focus/temporary mode   |
| `Option/Alt` while dragging      | Temporarily release the grid |
