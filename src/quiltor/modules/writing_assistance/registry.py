from __future__ import annotations

MANIFEST_VERSION = "2026.08.09"

SOURCES = {
    "wiktionary": {
        "version": "dewiktionary-2026-08-01",
        "url": "https://dumps.wikimedia.org/dewiktionary/20260801/dewiktionary-20260801-pages-articles.xml.bz2",
        "checksum": "sha1:29018e4b843f122fdca03a3b210779af07114d26",
        "license": "CC BY-SA 4.0 / GFDL",
        "attribution": "Deutschsprachiges Wiktionary; maschinenlesbare Extraktion durch Wiktextract/Kaikki.org",
    },
    "openthesaurus": {
        "version": "2026-08-08",
        "url": "https://www.openthesaurus.de/export/OpenThesaurus-Textversion.zip",
        "checksum": "sha256:4fb8f5544848736fc55797a547d305ccad1d678166738473994ad0b3fa71d5a3",
        "license": "CC BY-SA 4.0",
        "attribution": "OpenThesaurus.de",
    },
    "freedict-deu-eng": {
        "version": "0.3",
        "url": "https://download.freedict.org/dictionaries/deu-eng/0.3/freedict-deu-eng-0.3.src.tar.bz2",
        "checksum": "sha512:4e9c1a3aac7bb34073f087fe2b7163d41ca2e31abeb7434bcdef34bbefca46d390e57e45cb730db2700a3daaf7dbba21f4f949f3ea6a74770f353ccdc5c18a85",
        "license": "GPL (see dictionary TEI header)",
        "attribution": "FreeDict deu-eng",
    },
    "freedict-eng-deu": {
        "version": "0.3.6",
        "url": "https://download.freedict.org/dictionaries/eng-deu/0.3.6/freedict-eng-deu-0.3.6.src.tar.bz2",
        "checksum": "sha512:d4e7a751c00db462d964364047ff2194c3cad3a762150120f58cf3589ddf9c2df02c82f4f655d1446a4e021824b0d9f724efb666c69b19b00d05c7d4460c5a54",
        "license": "GPL (see dictionary TEI header)",
        "attribution": "FreeDict eng-deu",
    },
}


def manifest() -> dict:
    return {"version": MANIFEST_VERSION, "sources": SOURCES}
