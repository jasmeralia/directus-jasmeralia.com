# PEP 440 conversion review - updated rules

Conversion analysis generated from a read-only Directus snapshot on 2026-11-15 02:12 UTC; the null-version cleanup below was applied to live Directus afterward.
Released games are excluded from the analysis and cleanup.

## Summary

- **3,437** rows fetched; **1,136** rows for games with game_status = released excluded.
- **2,270** rows remain in scope after cleanup; all have a reported_version.
- **2,099** rows have PEP 440 candidates accepted and canonicalized by Python packaging.
- **171** labeled rows remain for manual review, across **134** distinct labels and **58** games; **39** are marked current.
- The **31** in-scope null-version rows from the analysis snapshot were all non-current and have been deleted from Directus.

Of the previous review queue of 172 labeled rows, the added mappings resolve **51** (about 30%); **121** of those remain. The title check also flags **48** season-labeled rows where the game title does not identify the season, plus **2** combined chapter ranges that had previously received candidates.

## PEP 440 tests for the clarified examples

| Raw label | Proposed dotted form | PEP 440 result | Note |
|---|---|---|---|
| Ch. 2 Act 1c | 0.2.1.c | 0.2.1rc0 | PEP 440 treats .c as an rc prerelease marker. |
| Ch.4A | 0.4.0.a | 0.4.0a0 | PEP 440 treats .a as an alpha prerelease marker. |
| 0.3.1v | 0.3.1.v | 0.3.1+v | Dot-v is invalid; +v is a valid local version tag. |
| 0.4.0p | 0.4.0.p | 0.4.0+p | Dot-p is invalid; +p preserves it as a local tag. |
| Build 2E | 0.2.0.e | 0.2.0+e | Dot-e is invalid; +e preserves it as a local tag. |
| Chapter 4Up6Public | 0.4.6.0 | 0.4.6.0 | Valid four-part release. |
| Season 2 Chapter 2a | 0.2.0.a | 0.2.0a0 | Title verified as Stray Incubus: Season 2. |
| Update 32a | 0.32.0.a | 0.32.0a0 | Valid alpha prerelease after normalization. |
| 0.0.6m-j | 0.0.6.m-j | 0.0.6+m.j | Dot-m-j is invalid; local tag separators normalize to dots. |

Alpha/beta/rc suffixes follow PEP 440: for example, .a normalizes to a0, .b to b0, and .c to rc0. Other suffix letters such as v, p, and e need local-version metadata, introduced with +. Thus 0.3.1+v is valid; 0.3.1.v is not. The m-j local tag normalizes to m.j.

## Mapping assumptions

- Bare N maps to 0.N.0; an explicit vN starts a normal major release; two numeric components are padded to at least three.
- Chapter/episode/part hierarchy maps to release components, e.g. Chapter 2 Part 3 -> 0.2.3. Extra numeric parts are allowed by PEP 440.
- A season number may be omitted from the version only when the game title explicitly confirms that season. Season 2 Chapter 2a is Stray Incubus: Season 2 and maps to 0.2.0a0.
- Candidates were validated with Python packaging.version.Version; all counted candidates passed validation.

## Distinct labels still needing review

| Raw label | Rows | Current | Sources | Review issue |
|---|---:|---:|---|---|
| Prologue | 13 | 4 | gsl: 7, orion: 2, typhoon: 4 | No numbered release signal |
| Demo | 9 | 2 | gsl: 7, typhoon: 2 | No numbered release signal |
| Intro | 5 | 2 | gsl: 1, orion: 2, typhoon: 2 | No numbered release signal |
| Prologue-Rev2 | 5 | 3 | gsl: 1, orion: 2, typhoon: 2 | No unambiguous mapping rule matched |
| S2 Ch. 9 Early | 4 | 2 | orion: 2, typhoon: 2 | label says season 2, but title does not identify season 2 |
| S3 v0.23 | 4 | 0 | gsl: 4 | label says season 3, but title does not identify season 3 |
| Chapter 4 original new | 2 | 0 | orion: 1, typhoon: 1 | Release descriptor or source detail needs a mapping rule |
| S3 v0.24 | 2 | 0 | gsl: 2 | label says season 3, but title does not identify season 3 |
| S3 v0.25 | 2 | 2 | gsl: 2 | label says season 3, but title does not identify season 3 |
| 0.01 EA | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.02 EA | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.09.01M.POL | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.09.05M Full | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.1.1_bugfix | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.1.2_prologue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.1.5 P1 Final | 1 | 1 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.11 - Epilogue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11 - Prologue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11a - Epilogue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11a - Prologue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11a0.1 | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11b - Epilogue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.11b - Prologue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.17 Beta 1.3 | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.1_prologue | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.2.1.5 - Public | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.2_ch1 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.4 S2 | 1 | 1 | gsl: 1 | label says season 2, but title does not identify season 2 |
| 0.4.1_ch3 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.4.5.full | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.4_ch3 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.4p2 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.4RE | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.4S2 | 1 | 1 | typhoon: 1 | Multiple numeric signals; choose which represent release components |
| 0.5 Enhanced | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.5_ch4 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.6.1_ch5 | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.6_ch5 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.7 Alpha (no public) | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.8.31 B | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.8.31 FA2 | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 0.9 Remaster Aplha | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.9 Remaster Beta | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.9 Remaster Final | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| 0.Z | 1 | 1 | gsl: 1 | No unambiguous mapping rule matched |
| 0.ZF | 1 | 1 | typhoon: 1 | No unambiguous mapping rule matched |
| 04P1 | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 04P1  | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 5.0 - 12.12 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| 9.02M.POL | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Act 2 - 1.1.024 | 1 | 1 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Amber & Gold P1 (Chapter 60) | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Amber & Gold P3 (Chapter 62) | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Amber & Gold P4 (Ch. 63) | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Amber & Gold P5 | 1 | 1 | gsl: 1 | No unambiguous mapping rule matched |
| Ch. 2 - Dev Build 1 | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| Ch. 2 - Patreon Build 2 | 1 | 1 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| Chapter 1 - 1.0 | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| Chapter 2 - 3.11 | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| Chapter 7: The Definitive Story Overhaul | 1 | 1 | gsl: 1 | No unambiguous mapping rule matched |
| Days 1-19 Complete | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Demo Beta | 1 | 0 | gsl: 1 | No numbered release signal |
| Demo/Ep1 | 1 | 1 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| DLC: No Interruptions | 1 | 1 | gsl: 1 | No numbered release signal |
| E3 1.03 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Emma's Solo Ending | 1 | 0 | gsl: 1 | No numbered release signal |
| Ep. 11 Bonus 9 | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| Ep. 11 Parity | 1 | 1 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| Episode 6 - 0.6 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Final | 1 | 1 | gsl: 1 | No numbered release signal |
| Final P1 | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| Gold & Amber P2 (Chapter 61) | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Part 2 - 0.82 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| Prologue Remake | 1 | 0 | gsl: 1 | No numbered release signal |
| Prologue-Rev1 | 1 | 0 | gsl: 1 | No unambiguous mapping rule matched |
| Pt. Two 1.2 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| R16S2 | 1 | 0 | gsl: 1 | Multiple numeric signals; choose which represent release components |
| S1 Ch.1 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.2 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.3 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.4 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.5 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.6 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.7 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.8 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S1 Ch.9 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| S2 Ch. 11 | 1 | 1 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Ch.10 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Ch.9 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 1 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 2 P1 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 2 P2 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 2 P3 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 3 P1 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 3 P2 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 3 P3 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 4 P1 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Episode 4 P2 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 Final Steam | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 v1.1.14 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 v1.2.11 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 v1.3.13 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 v1.3.14 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S2 v1.4.7 | 1 | 1 | gsl: 1 | label says season 2, but title does not identify season 2 |
| S3 (10%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (20%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (24%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (32%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (36%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (5%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (52%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (56%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (60%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (68%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (72%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (76%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (80%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (84%) | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| S3 (88%) | 1 | 1 | gsl: 1 | Progress marker or combined/range label |
| Season 2 Episode 4 Part 2 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| Season 2: Chapters 1-3 Beta | 1 | 0 | gsl: 1 | Progress marker or combined/range label |
| Season 2: Chapters 1-3 Final | 1 | 1 | gsl: 1 | Progress marker or combined/range label |
| Season 2: Episode 5.01 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| Season 2: Episode 5.02 | 1 | 0 | gsl: 1 | label says season 2, but title does not identify season 2 |
| Season 2: Episode 5.03 | 1 | 1 | gsl: 1 | label says season 2, but title does not identify season 2 |
| Season1: Episode 1 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| Season1: Episode 2.01 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| Season1: Episode 3.01 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| Season1: Episode 4 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| Season1: Episode 4.03 | 1 | 0 | gsl: 1 | label says season 1, but title does not identify season 1 |
| Steam P1 | 1 | 0 | gsl: 1 | Release descriptor or source detail needs a mapping rule |
| TBA | 1 | 1 | gsl: 1 | No numbered release signal |
| v4.1.1 S4 Episode 1 GE | 1 | 0 | gsl: 1 | label says season 4, but title does not identify season 4 |
| WIP | 1 | 0 | gsl: 1 | No numbered release signal |

## Rows needing review

| Row ID | Game | Slug | Status | Source | Raw reported_version | Current | Review issue |
|---:|---|---|---|---|---|:---:|---|
| 2232 | 30 Days | 30-days | in_development | gsl | 0.7 Alpha (no public) | no | Release descriptor or source detail needs a mapping rule |
| 2353 | A College of Thirst & Claws - Season 1 | a-college-of-thirst-claws-season-1 | in_development | gsl | 0.01 EA | no | Multiple numeric signals; choose which represent release components |
| 3177 | A College of Thirst & Claws - Season 1 | a-college-of-thirst-claws-season-1 | in_development | gsl | 0.02 EA | yes | Multiple numeric signals; choose which represent release components |
| 3360 | Artifice | artifice | in_development | gsl | Prologue | no | No numbered release signal |
| 3254 | BDSM Academy | bdsm-academy | in_development | gsl | Prologue | no | No numbered release signal |
| 2233 | Bound by Blood | bound-by-blood | in_development | gsl | Prologue | yes | No numbered release signal |
| 242 | Bound by Blood | bound-by-blood | in_development | typhoon | Prologue | no | No numbered release signal |
| 2492 | Bound by Blood | bound-by-blood | in_development | typhoon | Prologue | yes | No numbered release signal |
| 1483 | Burning Boundaries Part 1 | burning-boundaries-part-1 | in_development | gsl | 0.1.5 P1 Final | yes | Release descriptor or source detail needs a mapping rule |
| 1482 | Burning Boundaries Part 1 | burning-boundaries-part-1 | in_development | gsl | Steam P1 | no | Release descriptor or source detail needs a mapping rule |
| 2279 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.1 | no | label says season 1, but title does not identify season 1 |
| 2280 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.2 | no | label says season 1, but title does not identify season 1 |
| 2281 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.3 | no | label says season 1, but title does not identify season 1 |
| 2282 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.4 | no | label says season 1, but title does not identify season 1 |
| 2283 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.5 | no | label says season 1, but title does not identify season 1 |
| 2284 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.6 | no | label says season 1, but title does not identify season 1 |
| 2285 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.7 | no | label says season 1, but title does not identify season 1 |
| 2286 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.8 | no | label says season 1, but title does not identify season 1 |
| 2287 | Companion of Darkness Season 2 | companion-of-darkness-season-2 | in_development | gsl | S1 Ch.9 | no | label says season 1, but title does not identify season 1 |
| 280 | Continuum - Season 1 | continuum-season-1 | in_development | gsl | Demo | no | No numbered release signal |
| 788 | Defending Lydia Collier | defending-lydia-collier | in_development | gsl | 0.17 Beta 1.3 | no | Release descriptor or source detail needs a mapping rule |
| 3370 | Dogma | dogma | in_development | gsl | 0.4 S2 | yes | label says season 2, but title does not identify season 2 |
| 3369 | Dogma | dogma | in_development | gsl | 0.4p2 | no | Multiple numeric signals; choose which represent release components |
| 3286 | Dogma | dogma | in_development | typhoon | 0.4S2 | yes | Multiple numeric signals; choose which represent release components |
| 797 | Empire of Heroes | empire-of-heroes | in_development | gsl | Prologue | no | No numbered release signal |
| 798 | Empire of Heroes | empire-of-heroes | in_development | gsl | Prologue-Rev1 | no | No unambiguous mapping rule matched |
| 799 | Empire of Heroes | empire-of-heroes | in_development | gsl | Prologue-Rev2 | yes | No unambiguous mapping rule matched |
| 183 | Empire of Heroes | empire-of-heroes | in_development | orion | Prologue-Rev2 | no | No unambiguous mapping rule matched |
| 2541 | Empire of Heroes | empire-of-heroes | in_development | orion | Prologue-Rev2 | yes | No unambiguous mapping rule matched |
| 260 | Empire of Heroes | empire-of-heroes | in_development | typhoon | Prologue-Rev2 | no | No unambiguous mapping rule matched |
| 2500 | Empire of Heroes | empire-of-heroes | in_development | typhoon | Prologue-Rev2 | yes | No unambiguous mapping rule matched |
| 392 | Fetish Locator: S&M Studio | fetish-locator-s-m-studio | in_development | gsl | S2 v1.1.14 | no | label says season 2, but title does not identify season 2 |
| 393 | Fetish Locator: S&M Studio | fetish-locator-s-m-studio | in_development | gsl | S2 v1.2.11 | no | label says season 2, but title does not identify season 2 |
| 394 | Fetish Locator: S&M Studio | fetish-locator-s-m-studio | in_development | gsl | S2 v1.3.13 | no | label says season 2, but title does not identify season 2 |
| 395 | Fetish Locator: S&M Studio | fetish-locator-s-m-studio | in_development | gsl | S2 v1.3.14 | no | label says season 2, but title does not identify season 2 |
| 2658 | Fetish Locator: S&M Studio | fetish-locator-s-m-studio | in_development | gsl | S2 v1.4.7 | yes | label says season 2, but title does not identify season 2 |
| 3040 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 1 | no | label says season 2, but title does not identify season 2 |
| 3041 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 2 P1 | no | label says season 2, but title does not identify season 2 |
| 3042 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 2 P2 | no | label says season 2, but title does not identify season 2 |
| 3043 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 2 P3 | no | label says season 2, but title does not identify season 2 |
| 3044 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 3 P1 | no | label says season 2, but title does not identify season 2 |
| 3045 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 3 P2 | no | label says season 2, but title does not identify season 2 |
| 3046 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 3 P3 | no | label says season 2, but title does not identify season 2 |
| 3048 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 4 P1 | no | label says season 2, but title does not identify season 2 |
| 3049 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Episode 4 P2 | no | label says season 2, but title does not identify season 2 |
| 3050 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S2 Final Steam | no | label says season 2, but title does not identify season 2 |
| 3054 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (10%) | no | Progress marker or combined/range label |
| 3055 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (20%) | no | Progress marker or combined/range label |
| 3056 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (24%) | no | Progress marker or combined/range label |
| 3057 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (32%) | no | Progress marker or combined/range label |
| 3058 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (36%) | no | Progress marker or combined/range label |
| 3053 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (5%) | no | Progress marker or combined/range label |
| 3060 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (52%) | no | Progress marker or combined/range label |
| 3061 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (56%) | no | Progress marker or combined/range label |
| 3062 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (60%) | no | Progress marker or combined/range label |
| 3064 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (68%) | no | Progress marker or combined/range label |
| 3065 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (72%) | no | Progress marker or combined/range label |
| 3066 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (76%) | no | Progress marker or combined/range label |
| 3067 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (80%) | no | Progress marker or combined/range label |
| 3068 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (84%) | no | Progress marker or combined/range label |
| 3069 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | S3 (88%) | yes | Progress marker or combined/range label |
| 3047 | FreshWomen - Season 3 | freshwomen-season-3 | unreleased | gsl | Season 2 Episode 4 Part 2 | no | label says season 2, but title does not identify season 2 |
| 3404 | Further Education | further-education | in_development | gsl | Episode 6 - 0.6 | no | Multiple numeric signals; choose which represent release components |
| 2651 | Glass Half Broken | glass-half-broken | in_development | gsl | Demo | yes | No numbered release signal |
| 2268 | God of the Sun | god-of-the-sun | in_development | gsl | Intro | no | No numbered release signal |
| 165 | God of the Sun | god-of-the-sun | in_development | orion | Intro | no | No numbered release signal |
| 2549 | God of the Sun | god-of-the-sun | in_development | orion | Intro | yes | No numbered release signal |
| 251 | God of the Sun | god-of-the-sun | in_development | typhoon | Intro | no | No numbered release signal |
| 2502 | God of the Sun | god-of-the-sun | in_development | typhoon | Intro | yes | No numbered release signal |
| 2720 | Halfway House | halfway-house | in_development | gsl | Ep. 11 Bonus 9 | no | Release descriptor or source detail needs a mapping rule |
| 2721 | Halfway House | halfway-house | in_development | gsl | Ep. 11 Parity | yes | Release descriptor or source detail needs a mapping rule |
| 3024 | Hearts on Parole | hearts-on-parole | in_development | gsl | 04P1 | yes | Multiple numeric signals; choose which represent release components |
| 2678 | Hearts on Parole | hearts-on-parole | in_development | gsl | 04P1  | no | Multiple numeric signals; choose which represent release components |
| 1243 | Her Last Piece | her-last-piece | in_development | gsl | Act 2 - 1.1.024 | yes | Multiple numeric signals; choose which represent release components |
| 257 | High Desire | high-desire | in_development | typhoon | Demo | no | No numbered release signal |
| 2503 | High Desire | high-desire | in_development | typhoon | Demo | yes | No numbered release signal |
| 1249 | I Have Known You | i-have-known-you | in_development | gsl | DLC: No Interruptions | yes | No numbered release signal |
| 682 | Karlsson's Gambit | karlsson-s-gambit | in_development | gsl | 0.8.31 B | no | Multiple numeric signals; choose which represent release components |
| 683 | Karlsson's Gambit | karlsson-s-gambit | in_development | gsl | 0.8.31 FA2 | yes | Multiple numeric signals; choose which represent release components |
| 657 | Kicked out King | kicked-out-king | in_development | gsl | Demo/Ep1 | yes | Release descriptor or source detail needs a mapping rule |
| 684 | Leaving DNA | leaving-dna | in_development | gsl | Demo | no | No numbered release signal |
| 2366 | Life's Gate | life-s-gate | in_development | gsl | WIP | no | No numbered release signal |
| 658 | Lisa Total Investigation! | lisa-total-investigation | in_development | gsl | Part 2 - 0.82 | no | Multiple numeric signals; choose which represent release components |
| 664 | Long Story Short | long-story-short | in_development | gsl | 0.11a0.1 | yes | Multiple numeric signals; choose which represent release components |
| 1462 | Lost Solace | lost-solace | in_development | gsl | Ch. 2 - Dev Build 1 | no | Release descriptor or source detail needs a mapping rule |
| 1463 | Lost Solace | lost-solace | in_development | gsl | Ch. 2 - Patreon Build 2 | yes | Release descriptor or source detail needs a mapping rule |
| 1459 | Lost Solace | lost-solace | in_development | gsl | Demo | no | No numbered release signal |
| 3352 | Love by the Water | love-by-the-water | in_development | gsl | 0.4RE | no | Multiple numeric signals; choose which represent release components |
| 3347 | Love by the Water | love-by-the-water | in_development | gsl | Demo | no | No numbered release signal |
| 2779 | More Than A Woman | more-than-a-woman | in_development | gsl | Demo | no | No numbered release signal |
| 1332 | My Bully Is My Lover | my-bully-is-my-lover | in_development | gsl | Emma's Solo Ending | no | No numbered release signal |
| 2412 | My Girlfriend's New Kink | my-girlfriend-s-new-kink | in_development | gsl | 0.Z | yes | No unambiguous mapping rule matched |
| 3237 | My Girlfriend's New Kink | my-girlfriend-s-new-kink | in_development | typhoon | 0.ZF | yes | No unambiguous mapping rule matched |
| 1349 | Nightmares of the Moon | nightmares-of-the-moon | in_development | gsl | Prologue | no | No numbered release signal |
| 3152 | No More Money - Season 1 | no-more-money-season-1 | in_development | gsl | v4.1.1 S4 Episode 1 GE | no | label says season 4, but title does not identify season 4 |
| 1187 | Once Again | once-again | in_development | gsl | Prologue | no | No numbered release signal |
| 205 | Once Again | once-again | in_development | orion | Prologue | no | No numbered release signal |
| 2573 | Once Again | once-again | in_development | orion | Prologue | yes | No numbered release signal |
| 265 | Once Again | once-again | in_development | typhoon | Prologue | no | No numbered release signal |
| 2508 | Once Again | once-again | in_development | typhoon | Prologue | yes | No numbered release signal |
| 1786 | Our Red String | our-red-string | in_development | gsl | 0.11 - Epilogue | no | Multiple numeric signals; choose which represent release components |
| 1780 | Our Red String | our-red-string | in_development | gsl | 0.11 - Prologue | no | Multiple numeric signals; choose which represent release components |
| 1784 | Our Red String | our-red-string | in_development | gsl | 0.11a - Epilogue | no | Multiple numeric signals; choose which represent release components |
| 1778 | Our Red String | our-red-string | in_development | gsl | 0.11a - Prologue | no | Multiple numeric signals; choose which represent release components |
| 1785 | Our Red String | our-red-string | in_development | gsl | 0.11b - Epilogue | no | Multiple numeric signals; choose which represent release components |
| 1779 | Our Red String | our-red-string | in_development | gsl | 0.11b - Prologue | no | Multiple numeric signals; choose which represent release components |
| 1760 | Our Red String | our-red-string | in_development | gsl | 0.5 Enhanced | no | Release descriptor or source detail needs a mapping rule |
| 1772 | Our Red String | our-red-string | in_development | gsl | 0.9 Remaster Aplha | no | Release descriptor or source detail needs a mapping rule |
| 1773 | Our Red String | our-red-string | in_development | gsl | 0.9 Remaster Beta | no | Release descriptor or source detail needs a mapping rule |
| 1774 | Our Red String | our-red-string | in_development | gsl | 0.9 Remaster Final | no | Release descriptor or source detail needs a mapping rule |
| 628 | Out of Touch | out-of-touch | in_development | gsl | Amber & Gold P1 (Chapter 60) | no | Multiple numeric signals; choose which represent release components |
| 630 | Out of Touch | out-of-touch | in_development | gsl | Amber & Gold P3 (Chapter 62) | no | Multiple numeric signals; choose which represent release components |
| 2655 | Out of Touch | out-of-touch | in_development | gsl | Amber & Gold P4 (Ch. 63) | no | Multiple numeric signals; choose which represent release components |
| 3423 | Out of Touch | out-of-touch | in_development | gsl | Amber & Gold P5 | yes | No unambiguous mapping rule matched |
| 629 | Out of Touch | out-of-touch | in_development | gsl | Gold & Amber P2 (Chapter 61) | no | Multiple numeric signals; choose which represent release components |
| 581 | Out of Touch | out-of-touch | in_development | gsl | Prologue Remake | no | No numbered release signal |
| 2667 | Paper Hearts | paper-hearts | in_development | gsl | Chapter 7: The Definitive Story Overhaul | yes | No unambiguous mapping rule matched |
| 396 | Perfect Son-In-Law: Hidden S-Rank | perfect-son-in-law-hidden-s-rank | in_development | gsl | Demo Beta | no | No numbered release signal |
| 3378 | Portal Heart Part Two | portal-heart-part-two | in_development | gsl | Pt. Two 1.2 | no | Multiple numeric signals; choose which represent release components |
| 3011 | Pulse | pulse | unreleased | gsl | TBA | yes | No numbered release signal |
| 2169 | Rivers of Astrum: Daughter of Darkness | rivers-of-astrum-daughter-of-darkness | in_development | gsl | 0.2.1.5 - Public | no | Release descriptor or source detail needs a mapping rule |
| 967 | Steps of Debauchery | steps-of-debauchery | in_development | gsl | 5.0 - 12.12 | no | Multiple numeric signals; choose which represent release components |
| 1180 | Stranded In Space | stranded-in-space | in_development | gsl | Days 1-19 Complete | no | Multiple numeric signals; choose which represent release components |
| 381 | Summer's Gone - Season 2 - Constellations | summer-s-gone-season-2-constellations | in_development | gsl | 0.4.5.full | no | Release descriptor or source detail needs a mapping rule |
| 384 | Summer's Gone - Season 2 - Constellations | summer-s-gone-season-2-constellations | in_development | gsl | Season 2: Chapters 1-3 Beta | no | Progress marker or combined/range label |
| 385 | Summer's Gone - Season 2 - Constellations | summer-s-gone-season-2-constellations | in_development | gsl | Season 2: Chapters 1-3 Final | yes | Progress marker or combined/range label |
| 1010 | Tales from the Unending Void Season 1 | tales-from-the-unending-void-season-1 | in_development | gsl | S3 v0.23 | no | label says season 3, but title does not identify season 3 |
| 1013 | Tales from the Unending Void Season 1 | tales-from-the-unending-void-season-1 | in_development | gsl | S3 v0.23 | no | label says season 3, but title does not identify season 3 |
| 1014 | Tales from the Unending Void Season 1 | tales-from-the-unending-void-season-1 | in_development | gsl | S3 v0.24 | no | label says season 3, but title does not identify season 3 |
| 1015 | Tales from the Unending Void Season 1 | tales-from-the-unending-void-season-1 | in_development | gsl | S3 v0.25 | yes | label says season 3, but title does not identify season 3 |
| 3097 | Tales From The Unending Void: Season 2 | tales-from-the-unending-void-season-2 | in_development | gsl | S3 v0.23 | no | label says season 3, but title does not identify season 3 |
| 3100 | Tales From The Unending Void: Season 2 | tales-from-the-unending-void-season-2 | in_development | gsl | S3 v0.23 | no | label says season 3, but title does not identify season 3 |
| 3101 | Tales From The Unending Void: Season 2 | tales-from-the-unending-void-season-2 | in_development | gsl | S3 v0.24 | no | label says season 3, but title does not identify season 3 |
| 3102 | Tales From The Unending Void: Season 2 | tales-from-the-unending-void-season-2 | in_development | gsl | S3 v0.25 | yes | label says season 3, but title does not identify season 3 |
| 975 | The Assistant Episode 2 | the-assistant-episode-2 | in_development | gsl | Final | yes | No numbered release signal |
| 974 | The Assistant Episode 2 | the-assistant-episode-2 | in_development | gsl | Final P1 | no | Release descriptor or source detail needs a mapping rule |
| 533 | The Last Embrace | the-last-embrace | in_development | gsl | 0.1.1_bugfix | no | Multiple numeric signals; choose which represent release components |
| 532 | The Last Embrace | the-last-embrace | in_development | gsl | 0.1.2_prologue | no | Multiple numeric signals; choose which represent release components |
| 531 | The Last Embrace | the-last-embrace | in_development | gsl | 0.1_prologue | no | Multiple numeric signals; choose which represent release components |
| 534 | The Last Embrace | the-last-embrace | in_development | gsl | 0.2_ch1 | no | Multiple numeric signals; choose which represent release components |
| 539 | The Last Embrace | the-last-embrace | in_development | gsl | 0.4.1_ch3 | no | Multiple numeric signals; choose which represent release components |
| 538 | The Last Embrace | the-last-embrace | in_development | gsl | 0.4_ch3 | no | Multiple numeric signals; choose which represent release components |
| 540 | The Last Embrace | the-last-embrace | in_development | gsl | 0.5_ch4 | no | Multiple numeric signals; choose which represent release components |
| 542 | The Last Embrace | the-last-embrace | in_development | gsl | 0.6.1_ch5 | yes | Multiple numeric signals; choose which represent release components |
| 541 | The Last Embrace | the-last-embrace | in_development | gsl | 0.6_ch5 | no | Multiple numeric signals; choose which represent release components |
| 2419 | The Lusanti Chronicles | the-lusanti-chronicles | in_development | gsl | Chapter 1 - 1.0 | no | Progress marker or combined/range label |
| 1548 | The Missing Part | the-missing-part | in_development | gsl | Prologue | no | No numbered release signal |
| 2947 | The Missing Part | the-missing-part | in_development | orion | Chapter 4 original new | no | Release descriptor or source detail needs a mapping rule |
| 2988 | The Missing Part | the-missing-part | in_development | typhoon | Chapter 4 original new | no | Release descriptor or source detail needs a mapping rule |
| 1655 | The Seven Realms - Realm 4: Syren'Hal | the-seven-realms-realm-4-syren-hal | in_development | gsl | E3 1.03 | no | Multiple numeric signals; choose which represent release components |
| 2907 | The Velan Reach - Book One: An Unbroken Line | the-velan-reach-book-one-an-unbroken-line | in_development | gsl | Demo | no | No numbered release signal |
| 2693 | Thirty Days | thirty-days | in_development | gsl | 0.09.01M.POL | no | Multiple numeric signals; choose which represent release components |
| 2695 | Thirty Days | thirty-days | in_development | gsl | 0.09.05M Full | no | Release descriptor or source detail needs a mapping rule |
| 2694 | Thirty Days | thirty-days | in_development | gsl | 9.02M.POL | no | Multiple numeric signals; choose which represent release components |
| 433 | u4ia | u4ia | in_development | gsl | Season 2: Episode 5.01 | no | label says season 2, but title does not identify season 2 |
| 434 | u4ia | u4ia | in_development | gsl | Season 2: Episode 5.02 | no | label says season 2, but title does not identify season 2 |
| 435 | u4ia | u4ia | in_development | gsl | Season 2: Episode 5.03 | yes | label says season 2, but title does not identify season 2 |
| 428 | u4ia | u4ia | in_development | gsl | Season1: Episode 1 | no | label says season 1, but title does not identify season 1 |
| 429 | u4ia | u4ia | in_development | gsl | Season1: Episode 2.01 | no | label says season 1, but title does not identify season 1 |
| 430 | u4ia | u4ia | in_development | gsl | Season1: Episode 3.01 | no | label says season 1, but title does not identify season 1 |
| 431 | u4ia | u4ia | in_development | gsl | Season1: Episode 4 | no | label says season 1, but title does not identify season 1 |
| 432 | u4ia | u4ia | in_development | gsl | Season1: Episode 4.03 | no | label says season 1, but title does not identify season 1 |
| 3387 | Vox Gremory | vox-gremory | in_development | gsl | R16S2 | no | Multiple numeric signals; choose which represent release components |
| 926 | Wet Nightmares | wet-nightmares | in_development | gsl | Chapter 2 - 3.11 | no | Progress marker or combined/range label |
| 745 | Young Again | young-again | in_development | gsl | S2 Ch. 11 | yes | label says season 2, but title does not identify season 2 |
| 744 | Young Again | young-again | in_development | gsl | S2 Ch.10 | no | label says season 2, but title does not identify season 2 |
| 743 | Young Again | young-again | in_development | gsl | S2 Ch.9 | no | label says season 2, but title does not identify season 2 |
| 186 | Young Again | young-again | in_development | orion | S2 Ch. 9 Early | no | label says season 2, but title does not identify season 2 |
| 2611 | Young Again | young-again | in_development | orion | S2 Ch. 9 Early | yes | label says season 2, but title does not identify season 2 |
| 261 | Young Again | young-again | in_development | typhoon | S2 Ch. 9 Early | no | label says season 2, but title does not identify season 2 |
| 2517 | Young Again | young-again | in_development | typhoon | S2 Ch. 9 Early | yes | label says season 2, but title does not identify season 2 |

## Null-version rows removed after review

A live Directus recheck found 31 non-Released rows with `reported_version = null` and `is_current = false`. All 31 were deleted on 2026-11-15. No non-current null-version rows remain for non-Released games. Released-game rows and current rows were not touched.

Deleted row IDs: `2, 4, 19, 21, 22, 23, 25, 35, 37, 40, 48, 50, 59, 61, 74, 81, 83, 92, 98, 106, 116, 123, 126, 130, 144, 2816, 2817, 2818, 2819, 3022, 3023`.

## Review rows by source

| Source | Rows |
|---|---:|
| gsl | 147 |
| orion | 9 |
| typhoon | 15 |
