# Competitor pain points

**Collected:** 13 September 2026
**Purpose:** Evidence for roadmap decisions. Each finding records what hurts users of comparable
products, so Quiltor can avoid the same failure or turn it into a reason to switch. This is a
snapshot; forum and review data ages quickly.

## Method and limits

- **Sources:** vendor forums searched through their Discourse JSON API (Literature & Latte for
  Scrivener, Papyrus Community), Trustpilot, Capterra, Apple App Store, public feedback boards
  (Novlr), GitHub issues of open-source competitors (Manuskript, bibisco), and press coverage.
- **Time window:** mainly January–September 2026. Older items are marked with their year.
- **Not reachable:** Reddit, Google Play, the World Anvil bug tracker, the Dabble suggestion board.
  The Novelcrafter feedback board was closed and moved to Discord.
- **Bias:** Trustpilot samples are small for some products (Dabble 5, LivingWriter 17). Several
  "review" articles are written by competitors (Inkwarden, ProseEngine, BookDesignerAI); they are
  used only where users' own reports confirm them. Forum counts show volume, not share of users.

## Products compared

| Product                     | Kind                                                     | Closeness to Quiltor                |
| --------------------------- | -------------------------------------------------------- | ----------------------------------- |
| Papyrus Autor 12            | German all-in-one author software                        | Same audience (German-speaking)     |
| Scrivener 3                 | Manuscript binder and compile                            | The tool most authors switch from   |
| Campfire                    | Writing plus modular worldbuilding, subscription         | Same scope                          |
| Novelcrafter                | Browser writing app with Codex and bring-your-own-key AI | Same scope, AI-heavy                |
| Inkwarden                   | World and manuscript in one place, AI continuity         | Same idea; early access, no reviews |
| World Anvil                 | Worldbuilding wiki                                       | World side only                     |
| Dabble, LivingWriter, Novlr | Cloud writing apps with planning                         | Writing side, sync                  |
| Plottr, Aeon Timeline       | Plotting and timelines                                   | Timeline and Storyboard             |
| Atticus                     | Writing plus book formatting                             | Export                              |
| Manuskript, bibisco         | Open-source, local                                       | Local-first model                   |
| Sudowrite                   | AI ghostwriter                                           | Counter-model                       |

## Findings by theme

### 1. Data that appears lost

The strongest emotional signal across all products, and the one that ends trust permanently.

- **Scrivener — forum, 2026:** a steady stream of threads: "PC update lost my work" (22 Jun), "Lost
  my project!" (29 Jun), "Cannot access my work" (30 Jun), "My entire project vanished, not in
  recent projects, no backup" (26 Aug), "Work randomly deleted" (28 Aug), "Scrivener lost all my
  content" (30 Aug).
- **Scrivener staff, 25 Jun 2026** ("Scrivener did not eat your data"): cloud "smart sync" that
  keeps files online-only is the number one cause of data that _appears_ lost. It is followed by
  two cloud services on one folder, forgotten project locations, and "Save As" leaving live copies
  behind. Recommended fixes are all manual.
- **Scrivener, 2026:** tables break after reopening a project (27 Jul); hyperlinks are lost when
  converting footnotes (11 Jun); in the outliner, clicking a field selects its text and invites
  accidental deletion that undo does not restore (6 May).
- **Dabble — Trustpilot, 17 Feb 2026:** a large part of a book disappeared; mail and chat went
  unanswered. Reedsy's 2026 review (a competitor) quotes an undated user report of scrambled
  chapters with no way back to an earlier version.
- **World Anvil — Trustpilot, Oct 2025:** notes lost repeatedly through unexplained errors.
  **Feb 2026:** a new visual editor broke formatting when switching between the old and new edit
  views. World Anvil's own documentation warns that migrating to the new editor can lose formatting
  or content.
- **Manuskript — GitHub #1392 (Sep 2025):** creating and sorting a subfolder deletes the whole
  subfolder with its content. The maintainer says crashes can still lose data (#1428, Jun 2026).
- **Atticus — 2026 reviews:** chapters reported disappearing after a sync; pasted content
  corrupting formatting.
- **Aeon Timeline 3:** users report data loss when moving projects from version 2 to 3.

**For Quiltor:** SQLite with Markdown mirrors, local backups, content-addressed snapshots and
revision checks are a real advantage. But none of it helps if the author cannot see it. Make the
save state, the last backup and the data location visible. Guard against cloud placeholder
folders. Treat every tree move and every migration as a data-loss risk with its own regression
test.

### 2. Import that silently drops text

- **LivingWriter — Trustpilot, 7 Aug 2026:** a manuscript shrank from 290 to 56 pages during
  conversion, and character names were mixed up. The export then delivered the unconverted version.
- **Papyrus — forum, 2026:** "Text aus MS Word importieren" (5 Jul) asks to keep Word styles on
  import. "Warum fügt Papyrus plötzlich …" (18 Jul) reports import creating unwanted chapter
  structures. Numbered headings break after import (9 Mar). Foreign-format conversion settings do
  not apply (22 Jan). Users ask for Markdown import (10 Sep) and PDF import (2 Jul).
- **Papyrus — "Lektorats-Version zurück in Papyrus", 26 Jul 2026:** the editor works in Word with
  tracked changes. Bringing that version back loses notes, boards, chapter headings and scene
  divisions. The workaround is copying back paragraph by paragraph, taking half a day, and sentences
  still go missing. No solution was offered.
- **Novelcrafter:** "Create summaries after import" was one of the most active items on its former
  feedback board (about 195 entries). Reviews from April 2026 complain that importing means
  describing everything a second time in the Codex.
- **Scrivener, 2026:** endnotes from imported Word files are numbered wrongly (29 Jul); a complex
  MindNode import is confusing (12 Sep).

**For Quiltor:** import is the switching moment. It must prove completeness (word and paragraph
counts before and after), show the detected chapter split before committing, and keep emphasis and
scene breaks. It should then offer "update world from manuscript" so the world model fills itself.
The editor round-trip (DOCX with tracked changes back into existing chapters) is a distinct, painful
workflow that no competitor examined here solves.

### 3. Export and "compile" as a configuration maze

- **Scrivener — forum, March–September 2026:** at least 45 compile threads started in six months (the
  search returns 50 per page). "Compile is a
  confusing mess" (10 Mar): after four novels the author never got compile to work and formatted in
  Word after four hours. Staff answers point to tutorial videos and two manual chapters. Recurring
  issues: page breaks ignored, chapter titles missing, headings duplicated, italics in the wrong
  font, EPUB styles changing (Heading 2 centred in EPUB), compile stopping at 80 %, back matter
  truncated in PDF.
- **Papyrus — forum, 2026:** DOCX export drops chapter numbers (29 Apr). An EPUB opens on the
  imprint instead of the title page (15 Jul). Highlighter colours change in PDF (11 Jun). "Verzweiflung
  beim EBook erstellen" (3 Jun). The spring update fixed a broken PDF export with RGB images. On the
  other hand, users praise one-click standard manuscript pages ("Normseite") and simple
  EPUB/DOCX/PDF export.
- **Atticus — 2026 reviews:** PDF exports hanging for days, an EPUB rejected by Draft2Digital on
  upload.
- **Novlr — public roadmap:** "Publisher-ready manuscript export" (45 votes) is in progress.
- **Plottr — Trustpilot, Feb 2025:** Word export failing for weeks.

**For Quiltor:** today only a 6 × 9 in book PDF exists. Better export should offer presets
instead of a compile designer: German Normseite, DOCX for editors and agents, EPUB 3 that passes
validation, and print PDF in common trim sizes. Show a preview first, and validate the result
before the author uploads it anywhere.

### 4. Sync between devices

- **Scrivener — forum, 2026:** more than 30 threads started since March concern sync, many of them
  failures. Dropbox and iCloud failures
  between Mac and iPad, conflicted copies on every save (26 Jul), invalid binder structure after
  sync (12 Apr), "All files gone. 3 books in flight" (5 May), "I Dropped Dropbox for Good" (16 Apr),
  unwanted OneDrive integration (11 Jul). Sync prompts crash the Mac app (22 Aug). Scrivener has no
  sync of its own; it relies on third-party folders.
- **Dabble — help centre:** offline work on two devices will not merge; the web app's offline mode
  is fragile enough that Dabble tells users to export often.
- **Novlr — public roadmap:** "Offline app" is the most-voted open request (83 votes). Cloud-first
  products lose users who want to work offline.
- **Campfire, 2026:** the app requires Wi-Fi. Mobile users report being unable to log in, and text
  input lost on new phones.
- **Atticus — 2026 reviews:** "offline" errors and temporary loss of access to one's own
  manuscripts.

**For Quiltor:** sync must never be files in someone else's sync folder. It should be Quiltor's
own revision-aware service, where the local copy stays authoritative and fully usable offline, and
conflicts are shown, never resolved by overwriting. Ending the subscription must leave everything
local and usable.

### 5. Support nobody answers

- **Papyrus — Trustpilot, 2026:** one-star reviews about support on 8 Jan (no mail answer, no phone,
  broken download links), 8 Apr, 21 Jun, 18 Jul (a user banned from the forum after asking for
  help) and 6 Aug.
- **Dabble, 17 Feb 2026** and **LivingWriter, Aug 2025:** no response while work was missing or
  money was taken.
- **Scrivener staff, Oct 2025:** users ask Google or ChatGPT instead of the manual, although the
  answer is on the first page of the relevant section.

**For Quiltor:** a solo project has the same risk. The author must be able to recover data and
understand errors without support: restore from backup inside the app, error messages that say
what happened and what to do, and a diagnostics bundle that can be sent if needed.

### 6. Licences, subscriptions and online checks

- **Papyrus 12:** price almost doubled to 349 €. The licence terms require an online check every 14
  days and an account. Trustpilot reviews call the online requirement a no-go (Aug 2025, 5 May 2026,
  6 Aug 2026). A 2025 review describes a purchased program declaring itself expired after inactivity.
- **World Anvil — Trustpilot, 20 Jun 2026:** a forgotten yearly plan renewed without advance notice;
  refund refused.
- **LivingWriter — Trustpilot, Aug–Sep 2025:** auto-renewal without warning; subscription costs
  compared unfavourably with Scrivener's one-time price.
- **Aeon Timeline 3 — App Store, Jan 2025:** a new Mac required paying again; the old version became
  read-only.
- **Novelcrafter — reviews, April 2026:** AI costs come on top of the subscription through the
  user's own API key, and the trial already spends tokens.
- **Sudowrite (undated reports):** credits run out quickly; a charge despite a paused subscription.
- **bibisco — GitHub #395 (Jul 2026):** users want to dismiss a recurring upsell prompt.

**For Quiltor:** paid features are acceptable when they add something (sync, cloud storage,
stronger AI). Trust breaks when payment gates the author's own data, when renewals surprise, or when
usage anxiety (credits, tokens) accompanies writing.

### 7. Complexity and learning curve

- **Scrivener:** a 2025 feature request to simplify settings (overlapping controls, several
  configuration locations). Compile terminology ("Section Types" vs "Section Layouts") confuses even
  long-time users (Mar 2026).
- **Papyrus — forum, 22 Feb 2026:** several users do not use the timeline at all, calling it
  overloaded. They plan in Apple Calendar, Thunderbird, Excel or Aeon instead. What they want is
  quick answers such as "which weekday is this?" or "which holidays fall in this period?". A 2024
  switching report left Papyrus because timeline, character cards and mood board were too awkward
  to use.
- **World Anvil — Trustpilot, 17 Apr 2026:** hard to navigate; cancelled after three weeks.
- **Aeon Timeline — App Store, 2024–2025:** terminology confusing, harder than learning a
  programming language, timeline too rigid for episodic fiction.
- **Novelcrafter — April 2026:** onboarding asks to "update codex entries" without explaining what
  the Codex is.
- **Papyrus — forum, Mar–Apr 2026 (worldbuilding thread):** authors split into discovery writers who
  document the world as it emerges and planners who build it first. Several warn that
  over-planning stopped them from writing the novel at all.

**For Quiltor:** five workspaces, a signed relative time axis, calendars, presence and an
assistant carry the same risk. Advanced concepts need progressive disclosure. German labels should
be tested with authors, not only reviewed by the developer. "Write first, the world follows" suits
discovery writers and should be the default path.

### 8. Performance on real-sized projects

- **Campfire:** gets slower as character data grows; scrolling jumps or turns black (App Store,
  2023).
- **Plottr — Capterra:** slows down beyond a certain number of cards.
- **Aeon Timeline:** struggles above roughly 25,000 elements; saves every field individually.
- **World Anvil — bug tracker (undated):** 10–60 seconds per page load.
- **Papyrus — forum, 23 Jul 2026:** the thinking board lags with many board templates.
- **Dabble — Trustpilot, Apr 2025:** high CPU use drains laptop batteries.

**For Quiltor:** graph, Storyboard canvas and timeline should have a performance budget measured
against a large fixture world, not the demo world.

### 9. Platform neglect and trust in maintenance

- **Scrivener:** forum threads ask whether Windows is still developed (2025). Windows 11 with mixed
  monitor scaling misplaces UI (20 Aug 2026); staff blame outdated frameworks. The iOS app's last
  listed update is from September 2023.
- **Manuskript:** "Abandonware?" (#1428, Jun 2026). Windows Defender flags the unsigned Windows build
  as a trojan (#1396, #1399, #1401, #1404, #1426, Oct 2025–Apr 2026).
- **bibisco:** "Is this project still being maintained?" (#381, Jun 2025).
- **Campfire:** the iPad app runs in phone mode.

**For Quiltor:** store builds solve signing, but direct builds and the bundled `llama-server.exe`
still trigger scanners. A visible changelog and release cadence answer the "is this still alive"
question before it is asked.

### 10. AI: wanted for research, rejected for prose

- **Papyrus — "KI-Suche innerhalb / außerhalb von Papyrus", 25 Jun–21 Jul 2026:** authors want
  content-based search ("find the scene where …"), short answers, no chatbot essays. Today they
  export HTML and upload it to Claude, or run local models in LM Studio. The concerns are privacy
  (someone reading along), missing hardware for local models, and hallucinated summaries instead of
  quoted passages.
- **Papyrus — forum, Jan 2026:** a newcomer wants to trace every mention of a character to check
  plausibility. The answers are a filter in the Organizer, search-and-replace, or a custom GPT.
- **World Anvil — Trustpilot, 20 Jul 2026:** a user leaves over AI content on the platform.
- **Scrivener — forum:** the "ChatGPT or other LLM integration" wishlist thread (started 2025) and
  "The Writer-Novelist in the World of AI" were both still active in August and September 2026.
- **Publishing, 2026:** Hachette withdrew a novel in March after AI accusations. SFWA excludes works
  partly written by LLMs. Surveys (Authors Guild 2023, BookBub 2025) show authors accept AI for
  research, grammar and marketing and reject it for prose.
- **Scrivener — "Proving that you aren't an AI", 12–22 Aug 2026:** an author wrote Git scripts to
  keep a daily edit history as evidence against future accusations. Snapshots are manual and
  backups are whole copies. iA Writer ships an "Authorship" feature that marks AI and pasted text.

**For Quiltor:** the "AI never writes prose" boundary matches what authors accept. Semantic search
that returns verbatim passages with links, and continuity checks with evidence, are exactly the
workflows Papyrus users currently build by hand with external tools. The snapshot history could
become evidence of human authorship, and the no-prose assistant makes that evidence credible.

## Where Quiltor is exposed today

- No import of existing manuscripts.
- Export only as a 6 × 9 in book PDF.
- No device sync; the remote backup needs a self-hosted endpoint.
- Solo maintenance and support.
- Many concepts at once for a new author; untested with authors outside the project.
- Store builds are still `scaffold`; direct Windows builds are unsigned.

## Sources

- Literature & Latte forum (Scrivener): <https://forum.literatureandlatte.com/> — searched with
  `search.json` for "lost", "sync", "compile", "confusing" after 1 March 2026. Key threads:
  [PC update lost my work](https://forum.literatureandlatte.com/t/pc-update-lost-my-work/154098),
  [Scrivener did not eat your data](https://forum.literatureandlatte.com/t/scrivener-did-not-eat-your-data/),
  [Compile is a confusing mess](https://forum.literatureandlatte.com/t/153286),
  [Proving that you aren't an AI](https://forum.literatureandlatte.com/t/154430),
  [Simplify Scrivener's settings](https://forum.literatureandlatte.com/t/151110),
  [Things not appearing in the right place](https://forum.literatureandlatte.com/t/things-not-appearing-in-the-right-place-on-the-scrivener-screen/154477),
  [Updates for the Windows version](https://forum.literatureandlatte.com/t/updates-for-the-windows-version-of-scrivener/146626)
- Papyrus Community: <https://community.papyrus.de/> — searched for "Absturz", "verloren",
  "Export", "Import", "Zeitstrahl" after 1 January 2026. Key threads:
  [Lektorats-Version zurück in Papyrus](https://community.papyrus.de/t/39749),
  [KI-Suche innerhalb / außerhalb von Papyrus](https://community.papyrus.de/t/39582),
  [Meine Alternative zum Zeitstrahl](https://community.papyrus.de/t/38423),
  [Figuren und ihre Erwähnung im Text](https://community.papyrus.de/t/38018),
  [Worldbuilding – Wieviel Arbeit investiert ihr?](https://community.papyrus.de/t/38815)
- Papyrus 12 licence terms: <https://papyrus.de/en/legal/terms>
- Trustpilot: [Papyrus](https://de.trustpilot.com/review/papyrus.de),
  [World Anvil](https://www.trustpilot.com/review/worldanvil.com),
  [Dabble](https://www.trustpilot.com/review/dabblewriter.com),
  [LivingWriter](https://www.trustpilot.com/review/livingwriter.com),
  [Plottr](https://www.trustpilot.com/review/plottr.com)
- Capterra: [Scrivener](https://www.capterra.com/p/180597/Scrivener/reviews/),
  [Plottr](https://www.capterra.com/p/264561/Plottr/reviews/)
- App Store: [Campfire](https://apps.apple.com/us/app/campfire-write-your-book/id1626123915?see-all=reviews&platform=iphone),
  [Aeon Timeline 3](https://apps.apple.com/us/app/aeon-timeline-3/id1563351378?see-all=reviews&platform=mac),
  [Scrivener 3](https://apps.apple.com/us/app/scrivener-3/id1310686187?see-all=reviews)
- World Anvil documentation: [Text editors](https://www.worldanvil.com/w/WorldAnvilCodex/a/text-editors)
- Novlr public roadmap: <https://roadmap.novlr.org/>
- Dabble help centre: [How does Dabble work offline?](https://help.dabblewriter.com/en/articles/5491370-how-does-dabble-work-offline)
- Novelcrafter reviews:
  [Medium, April 2026](https://ilampadmanabhan.medium.com/novelcrafter-review-64d391c629a2),
  [toolworthy](https://www.toolworthy.ai/tool/novelcrafter),
  [bestaitables](https://bestaitables.com/novelcrafter-review/)
- Atticus: [BookDesignerAI review, July 2026 (competitor)](https://www.bookdesigner.ai/guides/atticus-review)
- GitHub: [olivierkes/manuskript issues](https://github.com/olivierkes/manuskript/issues),
  [andreafeccomandi/bibisco issues](https://github.com/andreafeccomandi/bibisco/issues)
- Switching report: [Tschüss, Papyrus – Hallo, Scrivener (Dec 2024)](https://silkeelzner.de/tschuess-papyrus-hallo-scrivener/)
- Publishing and AI: [Northeastern Global News, 28 May 2026](https://news.northeastern.edu/2026/05/28/book-publishing-ai-reckoning/),
  [Authorlytica, State of Author AI](https://authorlytica.com/state-of-author-ai/)
