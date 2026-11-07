# German writing tools

Manuscripts using writing language `de-DE` currently have local:

- dictionary lookup
- synonyms
- word translation
- spelling checks
- grammar checks

Selected text can be looked up. Insertion, replacement, and correction happen only after an explicit action and remain undoable.

The guided setup installs the language tools by default:

```bash
quiltor install
```

Data is stored under:

```text
data/writing-assistance/
```

or, for pipx/CLI installations:

```text
~/.quiltor/data/writing-assistance/
```

Existing data in the former `data/language/` directory is migrated safely on first launch;
no manual move is required.

LanguageTool requires **Java 17+**. Browser spellchecking remains available without it.

External LanguageTool-compatible services are only used when:

```bash
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

is set. Without that opt-in, chapter text and lookup terms used by this feature stay on the device.

For servers without Java, such as the Docker image, run LanguageTool as a separate service:

```bash
QUILTOR_LANGUAGETOOL_URL=http://languagetool:8010
QUILTOR_LANGUAGETOOL_EXTERNAL_OPT_IN=1
```

With both set, grammar checks go to that server and the writing aid shows neither the install
button nor the Java notice. With only the URL set and no local installation, it reports the service as
configured but not enabled; with the JAR and Java installed it counts as ready, and the "not
enabled" notice only appears as an error when a check is run. If the server does not answer, the error code is `writing_assistance.grammar_unavailable`.
Quiltor writes no chapter text to the log or to error messages.

## Language data for dictionary, synonyms, and translation

The data is a prebuilt package from a separate data release. It is downloaded on demand and not shipped with Quiltor. On install, Quiltor checks size and checksum before it accepts the data. It comes from the German Wiktionary and OpenThesaurus and is licensed as a whole under CC BY-SA 4.0.

Version 3.25.0 ships without a published package. The interface then shows "Die Sprachdaten folgen mit einem späteren Update." ("The language data will follow in a later update."), and `quiltor install` cannot load the data yet. Browser spellchecking remains available.

If you run Quiltor as a server, you install the data yourself: run `quiltor install` once on the server as soon as a package is published. The file lives in the data directory, which for the Docker image is the `/data` volume, and survives an image update. A server never downloads anything on its own.

Sources, versions, checksums, licenses, and attribution are recorded in the installation manifest and [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
