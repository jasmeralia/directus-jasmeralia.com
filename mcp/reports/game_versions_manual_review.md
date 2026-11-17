# `game_versions` manual conversion review

Generated from a read-only Directus snapshot on 2026-11-15 01:39 UTC.

## Summary

- **3,437** total `game_versions` rows.
- **2,247** non-null `reported_version` rows do not match strict SemVer syntax.
- **404** non-null rows need manual review under the proposed conversion rules below; **260** distinct raw labels across **139** games.
- **110** of the labeled review rows are marked current.
- **38** rows have no `reported_version` to convert; **2** are marked current. These are listed separately below.

## Conversion rules used for this first pass

This is a conservative review queue, not a data update. The check recognizes the examples and their close variants: bare `5` becomes `0.5.0`; `v1.0` becomes `1.0.0`; a chapter or episode number maps to `0.N.0`; a following part maps to the patch component; season/chapter/part maps to `season.chapter.part`; and alpha/beta/final qualifiers map to `a`/`b`/`f` suffixes. A clear explicit `v...` token takes precedence in a longer label. The shorthand suffix style follows the examples supplied, including `0.999999.2b`.

Labels are flagged when these rules cannot choose a conversion without inventing or discarding meaning. Common cases include unnumbered releases, progress percentages, ranges, extra numeric components, and mixed labels with several possible version signals.

## Distinct labels needing review

| Raw label | Rows | Current | Sources |
|---|---:|---:|---|
| `Prologue` | 13 | 4 | gsl: 7, orion: 2, typhoon: 4 |
| `Demo` | 10 | 2 | gsl: 8, typhoon: 2 |
| `Final` | 8 | 8 | gsl: 8 |
| `Intro` | 5 | 2 | gsl: 1, orion: 2, typhoon: 2 |
| `Prologue-Rev2` | 5 | 3 | gsl: 1, orion: 2, typhoon: 2 |
| `0.2.5.1` | 4 | 2 | gsl: 1, orion: 2, typhoon: 1 |
| `0.4.2 - Christmas Special` | 4 | 0 | gsl: 4 |
| `0.4.3.1` | 4 | 3 | gsl: 1, orion: 2, typhoon: 1 |
| `4.10.dlc` | 4 | 0 | gsl: 4 |
| `E3 1.03` | 4 | 0 | gsl: 4 |
| `Season 2 Chapter 3b` | 4 | 2 | orion: 2, typhoon: 2 |
| `0.1.8.7` | 3 | 2 | orion: 2, typhoon: 1 |
| `0.2.3.1` | 3 | 0 | gsl: 1, orion: 1, typhoon: 1 |
| `0.4p` | 3 | 2 | orion: 2, typhoon: 1 |
| `0.6.9.5` | 3 | 2 | gsl: 1, orion: 1, typhoon: 1 |
| `0.8.15b2` | 3 | 0 | orion: 2, typhoon: 1 |
| `03.6R` | 3 | 0 | gsl: 1, orion: 1, typhoon: 1 |
| `25.6.0c` | 3 | 0 | gsl: 3 |
| `Ch. 2 Act 1c` | 3 | 2 | gsl: 1, typhoon: 2 |
| `Ch.4A` | 3 | 2 | gsl: 1, typhoon: 2 |
| `DLC 1` | 3 | 0 | gsl: 3 |
| `DLC 2` | 3 | 0 | gsl: 3 |
| `DLC: Part 1` | 3 | 0 | gsl: 3 |
| `DLC: Part 2` | 3 | 3 | gsl: 3 |
| `Prologue: Part 1` | 3 | 1 | gsl: 1, typhoon: 2 |
| `S2 Final Steam` | 3 | 0 | gsl: 3 |
| `S3 (10%)` | 3 | 0 | gsl: 3 |
| `S3 (20%)` | 3 | 0 | gsl: 3 |
| `S3 (24%)` | 3 | 0 | gsl: 3 |
| `S3 (32%)` | 3 | 0 | gsl: 3 |
| `S3 (36%)` | 3 | 0 | gsl: 3 |
| `S3 (5%)` | 3 | 0 | gsl: 3 |
| `S3 (52%)` | 3 | 0 | gsl: 3 |
| `S3 (56%)` | 3 | 0 | gsl: 3 |
| `S3 (60%)` | 3 | 0 | gsl: 3 |
| `S3 (68%)` | 3 | 0 | gsl: 3 |
| `S3 (72%)` | 3 | 0 | gsl: 3 |
| `S3 (76%)` | 3 | 0 | gsl: 3 |
| `S3 (80%)` | 3 | 0 | gsl: 3 |
| `S3 (84%)` | 3 | 0 | gsl: 3 |
| `S3 (88%)` | 3 | 3 | gsl: 3 |
| `S3 (Act one)` | 3 | 0 | gsl: 3 |
| `S3 (Act two)` | 3 | 0 | gsl: 3 |
| `0.1.1C` | 2 | 2 | orion: 1, typhoon: 1 |
| `0.21 Extra` | 2 | 0 | gsl: 2 |
| `0.23.1.4` | 2 | 1 | gsl: 1, typhoon: 1 |
| `0.3.1v` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.4.0p` | 2 | 0 | gsl: 2 |
| `0.4.5.beta` | 2 | 0 | gsl: 2 |
| `0.4.5.full` | 2 | 0 | gsl: 2 |
| `0.5.0.beta` | 2 | 0 | gsl: 2 |
| `0.8.10r2` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.14r1` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.15a1` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.15r1` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.16b1` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.16r1` | 2 | 0 | orion: 1, typhoon: 1 |
| `0.8.17a1` | 2 | 2 | orion: 1, typhoon: 1 |
| `2.1.0ns` | 2 | 2 | gsl: 2 |
| `Build 2E` | 2 | 2 | orion: 1, typhoon: 1 |
| `Chapter 4 original new` | 2 | 0 | orion: 1, typhoon: 1 |
| `Chapter 4Up6Public` | 2 | 0 | orion: 1, typhoon: 1 |
| `DLC: No Interruptions` | 2 | 2 | gsl: 2 |
| `Episode 2 Full Beta` | 2 | 2 | orion: 1, typhoon: 1 |
| `Final P1` | 2 | 0 | gsl: 2 |
| `Season 2 Chapter 2a` | 2 | 0 | orion: 1, typhoon: 1 |
| `Season 2: Chapters 1-3 Beta` | 2 | 0 | gsl: 2 |
| `Season 2: Chapters 1-3 Final` | 2 | 2 | gsl: 2 |
| `Update 32a` | 2 | 1 | typhoon: 2 |
| `0.0.6m-j` | 1 | 0 | gsl: 1 |
| `0.0.6m-jh` | 1 | 0 | gsl: 1 |
| `0.0.6m-jhe` | 1 | 0 | gsl: 1 |
| `0.0.6m-jheg` | 1 | 0 | gsl: 1 |
| `0.0.6m-jhegn` | 1 | 0 | gsl: 1 |
| `0.0.9.0` | 1 | 0 | gsl: 1 |
| `0.0.9.1` | 1 | 0 | gsl: 1 |
| `0.01 EA` | 1 | 0 | gsl: 1 |
| `0.02 EA` | 1 | 1 | gsl: 1 |
| `0.09.01M.POL` | 1 | 0 | gsl: 1 |
| `0.09.05M Full` | 1 | 0 | gsl: 1 |
| `0.1.0 Remaster` | 1 | 0 | gsl: 1 |
| `0.1.1 P1` | 1 | 0 | gsl: 1 |
| `0.1.1 P2` | 1 | 0 | gsl: 1 |
| `0.1.1 P3` | 1 | 0 | gsl: 1 |
| `0.1.1_bugfix` | 1 | 0 | gsl: 1 |
| `0.1.1c` | 1 | 1 | gsl: 1 |
| `0.1.2_prologue` | 1 | 0 | gsl: 1 |
| `0.1.3.1` | 1 | 0 | gsl: 1 |
| `0.1.5 P1 Final` | 1 | 1 | gsl: 1 |
| `0.10.0c` | 1 | 1 | typhoon: 1 |
| `0.10.8.3` | 1 | 1 | gsl: 1 |
| `0.10.r4` | 1 | 0 | gsl: 1 |
| `0.11 - Epilogue` | 1 | 0 | gsl: 1 |
| `0.11 - Prologue` | 1 | 0 | gsl: 1 |
| `0.11a - Epilogue` | 1 | 0 | gsl: 1 |
| `0.11a - Prologue` | 1 | 0 | gsl: 1 |
| `0.11a0.1` | 1 | 1 | gsl: 1 |
| `0.11b - Epilogue` | 1 | 0 | gsl: 1 |
| `0.11b - Prologue` | 1 | 0 | gsl: 1 |
| `0.13.3.1` | 1 | 0 | gsl: 1 |
| `0.13.3.2` | 1 | 0 | gsl: 1 |
| `0.13.3.3` | 1 | 0 | gsl: 1 |
| `0.13.3.4` | 1 | 0 | gsl: 1 |
| `0.13.3.5` | 1 | 0 | gsl: 1 |
| `0.17 Beta 1.3` | 1 | 0 | gsl: 1 |
| `0.17.0.2` | 1 | 0 | gsl: 1 |
| `0.18.1 Extra` | 1 | 0 | gsl: 1 |
| `0.1_prologue` | 1 | 0 | gsl: 1 |
| `0.2.1.1` | 1 | 0 | gsl: 1 |
| `0.2.1.5 - Public` | 1 | 0 | gsl: 1 |
| `0.2.1.7` | 1 | 0 | gsl: 1 |
| `0.2.2.1` | 1 | 0 | gsl: 1 |
| `0.2.4.2` | 1 | 0 | gsl: 1 |
| `0.20 Pre-Alpha` | 1 | 1 | gsl: 1 |
| `0.20.5.0` | 1 | 0 | gsl: 1 |
| `0.22.5.0` | 1 | 1 | gsl: 1 |
| `0.23.2.2` | 1 | 1 | gsl: 1 |
| `0.26c` | 1 | 0 | gsl: 1 |
| `0.2_ch1` | 1 | 0 | gsl: 1 |
| `0.2R1` | 1 | 1 | typhoon: 1 |
| `0.3.5 Demo` | 1 | 0 | gsl: 1 |
| `0.3v` | 1 | 0 | gsl: 1 |
| `0.4 S2` | 1 | 1 | gsl: 1 |
| `0.4.1_ch3` | 1 | 0 | gsl: 1 |
| `0.4.5.1` | 1 | 0 | typhoon: 1 |
| `0.44.0 P1` | 1 | 0 | gsl: 1 |
| `0.4_ch3` | 1 | 0 | gsl: 1 |
| `0.4p2` | 1 | 0 | gsl: 1 |
| `0.4RE` | 1 | 0 | gsl: 1 |
| `0.4S2` | 1 | 1 | typhoon: 1 |
| `0.5 Enhanced` | 1 | 0 | gsl: 1 |
| `0.5.07c` | 1 | 1 | typhoon: 1 |
| `0.5.6.2` | 1 | 0 | gsl: 1 |
| `0.5.7.2` | 1 | 0 | gsl: 1 |
| `0.5_ch4` | 1 | 0 | gsl: 1 |
| `0.6.0.2` | 1 | 0 | gsl: 1 |
| `0.6.1.1` | 1 | 0 | gsl: 1 |
| `0.6.1_ch5` | 1 | 1 | gsl: 1 |
| `0.6.5.1` | 1 | 0 | typhoon: 1 |
| `0.6.5.3` | 1 | 0 | gsl: 1 |
| `0.6.6.1` | 1 | 0 | gsl: 1 |
| `0.6.6.2` | 1 | 0 | gsl: 1 |
| `0.6.9.7` | 1 | 1 | gsl: 1 |
| `0.64d` | 1 | 1 | typhoon: 1 |
| `0.6_ch5` | 1 | 0 | gsl: 1 |
| `0.7 Alpha (no public)` | 1 | 0 | gsl: 1 |
| `0.7 Premium` | 1 | 0 | gsl: 1 |
| `0.7.0.1` | 1 | 1 | typhoon: 1 |
| `0.7.19r1` | 1 | 0 | gsl: 1 |
| `0.7.5.3` | 1 | 0 | gsl: 1 |
| `0.8.11r2` | 1 | 0 | typhoon: 1 |
| `0.8.14a1` | 1 | 0 | typhoon: 1 |
| `0.8.31 FA2` | 1 | 1 | gsl: 1 |
| `0.9 Remaster Aplha` | 1 | 0 | gsl: 1 |
| `0.9 Remaster Beta` | 1 | 0 | gsl: 1 |
| `0.9 Remaster Final` | 1 | 0 | gsl: 1 |
| `0.Z` | 1 | 1 | gsl: 1 |
| `0.ZF` | 1 | 1 | typhoon: 1 |
| `03.5R` | 1 | 0 | gsl: 1 |
| `04P1` | 1 | 1 | gsl: 1 |
| `04P1 ` | 1 | 0 | gsl: 1 |
| `1.0.0.2` | 1 | 1 | gsl: 1 |
| `1.0.3 GOG DE` | 1 | 1 | gsl: 1 |
| `1.0.3 Steam + DLC` | 1 | 1 | gsl: 1 |
| `1.0.5p` | 1 | 1 | gsl: 1 |
| `1.02.01-2` | 1 | 1 | gsl: 1 |
| `1.04.10.6` | 1 | 1 | gsl: 1 |
| `1.1 - Stories` | 1 | 0 | gsl: 1 |
| `1.1 Demo` | 1 | 0 | gsl: 1 |
| `1.1.4c` | 1 | 0 | gsl: 1 |
| `1.2.08 All DLCs` | 1 | 0 | gsl: 1 |
| `1.3.24 All DLCs` | 1 | 0 | gsl: 1 |
| `1.4.12 All DLCs` | 1 | 1 | gsl: 1 |
| `1.5.0 Remake` | 1 | 0 | gsl: 1 |
| `1.7.0 Extended` | 1 | 0 | gsl: 1 |
| `26.8.0d` | 1 | 0 | gsl: 1 |
| `26.9.0e` | 1 | 0 | gsl: 1 |
| `3.0.7s` | 1 | 1 | gsl: 1 |
| `4.1 Lost Chapters` | 1 | 1 | gsl: 1 |
| `4.6.b` | 1 | 0 | gsl: 1 |
| `5.0 - 12.12` | 1 | 0 | gsl: 1 |
| `9.02M.POL` | 1 | 0 | gsl: 1 |
| `9.20.1 Premium` | 1 | 0 | gsl: 1 |
| `9.9.16 Premium` | 1 | 0 | gsl: 1 |
| `Act 2 - 1.1.024` | 1 | 1 | gsl: 1 |
| `Act 3 & 4 Beta` | 1 | 0 | gsl: 1 |
| `Amber & Gold P1 (Chapter 60)` | 1 | 0 | gsl: 1 |
| `Amber & Gold P3 (Chapter 62)` | 1 | 0 | gsl: 1 |
| `Amber & Gold P4 (Ch. 63)` | 1 | 0 | gsl: 1 |
| `Amber & Gold P5` | 1 | 1 | gsl: 1 |
| `Ch 14.1.1 Alpha` | 1 | 0 | gsl: 1 |
| `Ch 14.1.3` | 1 | 0 | gsl: 1 |
| `Ch. 1 Finale` | 1 | 0 | gsl: 1 |
| `Ch. 14.1.4b` | 1 | 0 | gsl: 1 |
| `Ch. 14.2.1a` | 1 | 0 | gsl: 1 |
| `Ch. 14.2.2b` | 1 | 0 | gsl: 1 |
| `Ch. 14.2.3` | 1 | 0 | gsl: 1 |
| `Ch. 1A` | 1 | 0 | gsl: 1 |
| `Ch. 1B` | 1 | 0 | gsl: 1 |
| `Ch. 1C` | 1 | 0 | gsl: 1 |
| `Ch. 2 - Dev Build 1` | 1 | 0 | gsl: 1 |
| `Ch. 2 - Patreon Build 2` | 1 | 1 | gsl: 1 |
| `Ch. 2 Finale` | 1 | 0 | gsl: 1 |
| `Ch. 20+21` | 1 | 0 | gsl: 1 |
| `Ch. 22+23` | 1 | 0 | gsl: 1 |
| `Ch. 2A` | 1 | 0 | gsl: 1 |
| `Ch. 2B` | 1 | 0 | gsl: 1 |
| `Ch. 2C` | 1 | 0 | gsl: 1 |
| `Ch. 3 Finale` | 1 | 0 | gsl: 1 |
| `Ch. 3A` | 1 | 0 | gsl: 1 |
| `Ch. 50+51` | 1 | 0 | gsl: 1 |
| `Ch.1 Ep.1 P1` | 1 | 0 | gsl: 1 |
| `Ch.1 Ep.1 P2` | 1 | 0 | gsl: 1 |
| `Ch.1 Ep.3 P1` | 1 | 0 | gsl: 1 |
| `Ch.1 Ep.3 P2` | 1 | 0 | gsl: 1 |
| `Ch.13.3.4` | 1 | 1 | gsl: 1 |
| `Ch.13.3.6` | 1 | 0 | gsl: 1 |
| `Ch.4 R1` | 1 | 0 | gsl: 1 |
| `Ch.4 R2` | 1 | 0 | gsl: 1 |
| `Ch.5 R1` | 1 | 0 | gsl: 1 |
| `Ch.5 R2` | 1 | 1 | gsl: 1 |
| `Chapter 1 - 0.1` | 1 | 0 | gsl: 1 |
| `Chapter 1 - 1.0` | 1 | 0 | gsl: 1 |
| `Chapter 10, Stories Expansion` | 1 | 1 | gsl: 1 |
| `Chapter 2 - 3.11` | 1 | 0 | gsl: 1 |
| `Chapter 3: Episode 3.1a` | 1 | 1 | gsl: 1 |
| `Chapter 7: The Definitive Story Overhaul` | 1 | 1 | gsl: 1 |
| `Christmas Special` | 1 | 1 | gsl: 1 |
| `Complete Edition` | 1 | 1 | gsl: 1 |
| `Days 1-19 Complete` | 1 | 0 | gsl: 1 |
| `Demo Beta` | 1 | 0 | gsl: 1 |
| `Demo/Ep1` | 1 | 1 | gsl: 1 |
| `Emma's Solo Ending` | 1 | 0 | gsl: 1 |
| `Ep. 11 Bonus 9` | 1 | 0 | gsl: 1 |
| `Ep. 11 Parity` | 1 | 1 | gsl: 1 |
| `Ep. 2 Full Beta` | 1 | 1 | gsl: 1 |
| `Epilogue` | 1 | 0 | gsl: 1 |
| `Epilogue 1` | 1 | 0 | gsl: 1 |
| `Epilogue 5` | 1 | 1 | gsl: 1 |
| `Epilouge 2` | 1 | 0 | gsl: 1 |
| `Epilouge 3` | 1 | 0 | gsl: 1 |
| `Episode 6 - 0.6` | 1 | 0 | gsl: 1 |
| `Episodes 1 & 2` | 1 | 0 | gsl: 1 |
| `Gold & Amber P2 (Chapter 61)` | 1 | 0 | gsl: 1 |
| `Part 2 - 0.82` | 1 | 0 | gsl: 1 |
| `Prologue Act I` | 1 | 1 | gsl: 1 |
| `Prologue Remake` | 1 | 0 | gsl: 1 |
| `Prologue-Rev1` | 1 | 0 | gsl: 1 |
| `Prologue: Part 2` | 1 | 0 | gsl: 1 |
| `Pt. Two 1.2` | 1 | 0 | gsl: 1 |
| `R16S2` | 1 | 0 | gsl: 1 |
| `S.1 v0.9.9.8` | 1 | 1 | gsl: 1 |
| `Season 1 Final` | 1 | 1 | gsl: 1 |
| `Season 2 - 0.26` | 1 | 0 | gsl: 1 |
| `Steam DLC` | 1 | 1 | gsl: 1 |
| `Steam P1` | 1 | 0 | gsl: 1 |
| `Steam S1` | 1 | 1 | gsl: 1 |
| `Supporter` | 1 | 1 | gsl: 1 |
| `TBA` | 1 | 1 | gsl: 1 |
| `WIP` | 1 | 0 | gsl: 1 |

## Rows needing review

| Row ID | Game | Slug | Source | Raw `reported_version` | Current |
|---:|---|---|---|---|:---:|
| 2232 | 30 Days | `30-days` | gsl | `0.7 Alpha (no public)` | no |
| 2353 | A College of Thirst & Claws - Season 1 | `a-college-of-thirst-claws-season-1` | gsl | `0.01 EA` | no |
| 3177 | A College of Thirst & Claws - Season 1 | `a-college-of-thirst-claws-season-1` | gsl | `0.02 EA` | yes |
| 1023 | A House In The Rift | `a-house-in-the-rift` | gsl | `0.7.19r1` | no |
| 2923 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.10r2` | no |
| 2952 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.14r1` | no |
| 2955 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.15a1` | no |
| 199 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.15b2` | no |
| 2523 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.15b2` | no |
| 2662 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.15r1` | no |
| 3412 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.16b1` | no |
| 3426 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.16r1` | no |
| 3469 | A House In The Rift | `a-house-in-the-rift` | orion | `0.8.17a1` | yes |
| 2958 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.10r2` | no |
| 2992 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.11r2` | no |
| 2994 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.14a1` | no |
| 2996 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.14r1` | no |
| 2998 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.15a1` | no |
| 9 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.15b2` | no |
| 2663 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.15r1` | no |
| 3268 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.16b1` | no |
| 3424 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.16r1` | no |
| 3470 | A House In The Rift | `a-house-in-the-rift` | typhoon | `0.8.17a1` | yes |
| 2139 | Actual Roommates! | `actual-roommates` | gsl | `Final` | yes |
| 3360 | Artifice | `artifice` | gsl | `Prologue` | no |
| 2822 | Ataegina Act I | `ataegina-act-i` | gsl | `Prologue Act I` | yes |
| 3254 | BDSM Academy | `bdsm-academy` | gsl | `Prologue` | no |
| 2187 | Between Two Worlds | `between-two-worlds` | gsl | `1.1 - Stories` | no |
| 2188 | Between Two Worlds | `between-two-worlds` | gsl | `Chapter 10, Stories Expansion` | yes |
| 2233 | Bound by Blood | `bound-by-blood` | gsl | `Prologue` | yes |
| 242 | Bound by Blood | `bound-by-blood` | typhoon | `Prologue` | no |
| 2492 | Bound by Blood | `bound-by-blood` | typhoon | `Prologue` | yes |
| 2189 | Breeze of Passion | `breeze-of-passion` | gsl | `Steam DLC` | yes |
| 2701 | Bright Lord | `bright-lord` | gsl | `Final` | yes |
| 1475 | Burning Boundaries Part 1 | `burning-boundaries-part-1` | gsl | `0.1.1 P1` | no |
| 1476 | Burning Boundaries Part 1 | `burning-boundaries-part-1` | gsl | `0.1.1 P2` | no |
| 1477 | Burning Boundaries Part 1 | `burning-boundaries-part-1` | gsl | `0.1.1 P3` | no |
| 1483 | Burning Boundaries Part 1 | `burning-boundaries-part-1` | gsl | `0.1.5 P1 Final` | yes |
| 1482 | Burning Boundaries Part 1 | `burning-boundaries-part-1` | gsl | `Steam P1` | no |
| 3278 | Cabin by the Lake | `cabin-by-the-lake` | typhoon | `0.64d` | yes |
| 2241 | Chronicles of Hell and Heaven | `chronicles-of-hell-and-heaven` | gsl | `Ch. 2 Act 1c` | yes |
| 246 | Chronicles of Hell and Heaven | `chronicles-of-hell-and-heaven` | typhoon | `Ch. 2 Act 1c` | no |
| 2612 | Chronicles of Hell and Heaven | `chronicles-of-hell-and-heaven` | typhoon | `Ch. 2 Act 1c` | yes |
| 2242 | Chronicles of Kartoba | `chronicles-of-kartoba` | gsl | `Prologue: Part 1` | no |
| 2243 | Chronicles of Kartoba | `chronicles-of-kartoba` | gsl | `Prologue: Part 2` | no |
| 243 | Chronicles of Kartoba | `chronicles-of-kartoba` | typhoon | `Prologue: Part 1` | no |
| 2493 | Chronicles of Kartoba | `chronicles-of-kartoba` | typhoon | `Prologue: Part 1` | yes |
| 2250 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 1 Finale` | no |
| 2247 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 1A` | no |
| 2248 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 1B` | no |
| 2249 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 1C` | no |
| 2254 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 2 Finale` | no |
| 2251 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 2A` | no |
| 2252 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 2B` | no |
| 2253 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 2C` | no |
| 2256 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 3 Finale` | no |
| 2255 | Color of My Sound | `color-of-my-sound` | gsl | `Ch. 3A` | no |
| 2258 | Color of My Sound | `color-of-my-sound` | gsl | `Ch.4A` | yes |
| 241 | Color of My Sound | `color-of-my-sound` | typhoon | `Ch.4A` | no |
| 2494 | Color of My Sound | `color-of-my-sound` | typhoon | `Ch.4A` | yes |
| 1605 | Come Home | `come-home` | gsl | `9.20.1 Premium` | no |
| 1604 | Come Home | `come-home` | gsl | `9.9.16 Premium` | no |
| 281 | Continuum - Season 1 | `continuum-season-1` | gsl | `1.1 Demo` | no |
| 280 | Continuum - Season 1 | `continuum-season-1` | gsl | `Demo` | no |
| 1195 | Crimson High | `crimson-high` | gsl | `0.44.0 P1` | no |
| 788 | Defending Lydia Collier | `defending-lydia-collier` | gsl | `0.17 Beta 1.3` | no |
| 790 | Defending Lydia Collier | `defending-lydia-collier` | gsl | `0.17.0.2` | no |
| 2215 | Deliverance | `deliverance` | gsl | `Final` | yes |
| 1244 | Denos City | `denos-city` | gsl | `Final` | yes |
| 3370 | Dogma | `dogma` | gsl | `0.4 S2` | yes |
| 3369 | Dogma | `dogma` | gsl | `0.4p2` | no |
| 3286 | Dogma | `dogma` | typhoon | `0.4S2` | yes |
| 3156 | Dreamland | `dreamland` | gsl | `0.4.0p` | no |
| 3157 | Dreamland | `dreamland` | gsl | `0.4.0p` | no |
| 1907 | Dreams of Desire | `dreams-of-desire` | gsl | `1.0.3 GOG DE` | yes |
| 3287 | Dreamscape | `dreamscape` | typhoon | `0.2R1` | yes |
| 2671 | Element-174 | `element-174` | gsl | `0.26c` | no |
| 797 | Empire of Heroes | `empire-of-heroes` | gsl | `Prologue` | no |
| 798 | Empire of Heroes | `empire-of-heroes` | gsl | `Prologue-Rev1` | no |
| 799 | Empire of Heroes | `empire-of-heroes` | gsl | `Prologue-Rev2` | yes |
| 183 | Empire of Heroes | `empire-of-heroes` | orion | `Prologue-Rev2` | no |
| 2541 | Empire of Heroes | `empire-of-heroes` | orion | `Prologue-Rev2` | yes |
| 260 | Empire of Heroes | `empire-of-heroes` | typhoon | `Prologue-Rev2` | no |
| 2500 | Empire of Heroes | `empire-of-heroes` | typhoon | `Prologue-Rev2` | yes |
| 2644 | Eruption Imminent - Season 1 | `eruption-imminent-season-1` | gsl | `1.0.5p` | yes |
| 1977 | Forbidden Fantasy | `forbidden-fantasy` | gsl | `Supporter` | yes |
| 3441 | Four Elements Trainer | `four-elements-trainer` | gsl | `1.1.4c` | no |
| 3440 | Four Elements Trainer | `four-elements-trainer` | typhoon | `0.5.07c` | yes |
| 1571 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `DLC 1` | no |
| 1572 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `DLC 2` | no |
| 1570 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S2 Final Steam` | no |
| 1574 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (10%)` | no |
| 1575 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (20%)` | no |
| 1576 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (24%)` | no |
| 1577 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (32%)` | no |
| 1578 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (36%)` | no |
| 1573 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (5%)` | no |
| 1580 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (52%)` | no |
| 1581 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (56%)` | no |
| 1582 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (60%)` | no |
| 1584 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (68%)` | no |
| 1585 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (72%)` | no |
| 1586 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (76%)` | no |
| 1587 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (80%)` | no |
| 1588 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (84%)` | no |
| 1589 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (88%)` | yes |
| 1579 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (Act one)` | no |
| 1583 | Freshwomen - Season 1 | `freshwomen-season-1` | gsl | `S3 (Act two)` | no |
| 355 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `DLC 1` | no |
| 356 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `DLC 2` | no |
| 354 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S2 Final Steam` | no |
| 358 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (10%)` | no |
| 359 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (20%)` | no |
| 360 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (24%)` | no |
| 361 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (32%)` | no |
| 362 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (36%)` | no |
| 357 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (5%)` | no |
| 364 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (52%)` | no |
| 365 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (56%)` | no |
| 366 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (60%)` | no |
| 368 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (68%)` | no |
| 369 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (72%)` | no |
| 370 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (76%)` | no |
| 371 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (80%)` | no |
| 372 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (84%)` | no |
| 373 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (88%)` | yes |
| 363 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (Act one)` | no |
| 367 | FreshWomen - Season 2 | `freshwomen-season-2` | gsl | `S3 (Act two)` | no |
| 3051 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `DLC 1` | no |
| 3052 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `DLC 2` | no |
| 3050 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S2 Final Steam` | no |
| 3054 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (10%)` | no |
| 3055 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (20%)` | no |
| 3056 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (24%)` | no |
| 3057 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (32%)` | no |
| 3058 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (36%)` | no |
| 3053 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (5%)` | no |
| 3060 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (52%)` | no |
| 3061 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (56%)` | no |
| 3062 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (60%)` | no |
| 3064 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (68%)` | no |
| 3065 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (72%)` | no |
| 3066 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (76%)` | no |
| 3067 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (80%)` | no |
| 3068 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (84%)` | no |
| 3069 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (88%)` | yes |
| 3059 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (Act one)` | no |
| 3063 | FreshWomen - Season 3 | `freshwomen-season-3` | gsl | `S3 (Act two)` | no |
| 3404 | Further Education | `further-education` | gsl | `Episode 6 - 0.6` | no |
| 2162 | Game of Hearts | `game-of-hearts` | gsl | `Ch.4 R1` | no |
| 2163 | Game of Hearts | `game-of-hearts` | gsl | `Ch.4 R2` | no |
| 2164 | Game of Hearts | `game-of-hearts` | gsl | `Ch.5 R1` | no |
| 2165 | Game of Hearts | `game-of-hearts` | gsl | `Ch.5 R2` | yes |
| 2651 | Glass Half Broken | `glass-half-broken` | gsl | `Demo` | yes |
| 2268 | God of the Sun | `god-of-the-sun` | gsl | `Intro` | no |
| 165 | God of the Sun | `god-of-the-sun` | orion | `Intro` | no |
| 2549 | God of the Sun | `god-of-the-sun` | orion | `Intro` | yes |
| 251 | God of the Sun | `god-of-the-sun` | typhoon | `Intro` | no |
| 2502 | God of the Sun | `god-of-the-sun` | typhoon | `Intro` | yes |
| 402 | Goddesses' Whim | `goddesses-whim` | gsl | `4.6.b` | no |
| 1949 | Good Girl Gone Bad | `good-girl-gone-bad` | gsl | `Ch.13.3.4` | yes |
| 2720 | Halfway House | `halfway-house` | gsl | `Ep. 11 Bonus 9` | no |
| 2721 | Halfway House | `halfway-house` | gsl | `Ep. 11 Parity` | yes |
| 415 | Harem Fantasy | `harem-fantasy` | gsl | `1.2.08 All DLCs` | no |
| 416 | Harem Fantasy | `harem-fantasy` | gsl | `1.3.24 All DLCs` | no |
| 3166 | Harem Fantasy | `harem-fantasy` | gsl | `1.4.12 All DLCs` | yes |
| 1543 | Harem Hotel | `harem-hotel` | gsl | `0.20 Pre-Alpha` | yes |
| 496 | Hearts on Parole | `hearts-on-parole` | gsl | `03.5R` | no |
| 2628 | Hearts on Parole | `hearts-on-parole` | gsl | `03.6R` | no |
| 3024 | Hearts on Parole | `hearts-on-parole` | gsl | `04P1` | yes |
| 2678 | Hearts on Parole | `hearts-on-parole` | gsl | `04P1 ` | no |
| 2627 | Hearts on Parole | `hearts-on-parole` | orion | `03.6R` | no |
| 2618 | Hearts on Parole | `hearts-on-parole` | typhoon | `03.6R` | no |
| 871 | Heartstrings | `heartstrings` | gsl | `0.2.2.1` | no |
| 872 | Heartstrings | `heartstrings` | gsl | `0.2.3.1` | no |
| 874 | Heartstrings | `heartstrings` | gsl | `0.2.4.2` | no |
| 875 | Heartstrings | `heartstrings` | gsl | `0.2.5.1` | no |
| 2929 | Heartstrings | `heartstrings` | orion | `0.2.3.1` | no |
| 195 | Heartstrings | `heartstrings` | orion | `0.2.5.1` | no |
| 2553 | Heartstrings | `heartstrings` | orion | `0.2.5.1` | yes |
| 2965 | Heartstrings | `heartstrings` | typhoon | `0.2.3.1` | no |
| 55 | Heartstrings | `heartstrings` | typhoon | `0.2.5.1` | yes |
| 1183 | Helping the Hotties | `helping-the-hotties` | gsl | `1.04.10.6` | yes |
| 1243 | Her Last Piece | `her-last-piece` | gsl | `Act 2 - 1.1.024` | yes |
| 257 | High Desire | `high-desire` | typhoon | `Demo` | no |
| 2503 | High Desire | `high-desire` | typhoon | `Demo` | yes |
| 2681 | House of Hearts | `house-of-hearts` | gsl | `Ep. 2 Full Beta` | yes |
| 2838 | House of Hearts | `house-of-hearts` | orion | `Episode 2 Full Beta` | yes |
| 2839 | House of Hearts | `house-of-hearts` | typhoon | `Episode 2 Full Beta` | yes |
| 1249 | I Have Known You | `i-have-known-you` | gsl | `DLC: No Interruptions` | yes |
| 2335 | I Have Known You: Halloween Edition | `i-have-known-you-halloween-edition` | gsl | `DLC: No Interruptions` | yes |
| 3343 | Kamogawa Island | `kamogawa-island` | gsl | `0.1.3.1` | no |
| 683 | Karlsson's Gambit | `karlsson-s-gambit` | gsl | `0.8.31 FA2` | yes |
| 657 | Kicked out King | `kicked-out-king` | gsl | `Demo/Ep1` | yes |
| 684 | Leaving DNA | `leaving-dna` | gsl | `Demo` | no |
| 1132 | Leviathan | `leviathan` | gsl | `0.3v` | no |
| 2935 | Leviathan | `leviathan` | orion | `0.3.1v` | no |
| 2972 | Leviathan | `leviathan` | typhoon | `0.3.1v` | no |
| 2366 | Life's Gate | `life-s-gate` | gsl | `WIP` | no |
| 1961 | Lilith Rising Episode 1 | `lilith-rising-episode-1` | gsl | `2.1.0ns` | yes |
| 1962 | Lilith Rising Episode 2 | `lilith-rising-episode-2` | gsl | `2.1.0ns` | yes |
| 2639 | Lisa Total Investigation! | `lisa-total-investigation` | gsl | `Chapter 3: Episode 3.1a` | yes |
| 658 | Lisa Total Investigation! | `lisa-total-investigation` | gsl | `Part 2 - 0.82` | no |
| 663 | Long Story Short | `long-story-short` | gsl | `0.10.r4` | no |
| 664 | Long Story Short | `long-story-short` | gsl | `0.11a0.1` | yes |
| 1462 | Lost Solace | `lost-solace` | gsl | `Ch. 2 - Dev Build 1` | no |
| 1463 | Lost Solace | `lost-solace` | gsl | `Ch. 2 - Patreon Build 2` | yes |
| 1459 | Lost Solace | `lost-solace` | gsl | `Demo` | no |
| 829 | Love & Sex: Second Base | `love-sex-second-base` | gsl | `25.6.0c` | no |
| 830 | Love & Sex: Second Base | `love-sex-second-base` | gsl | `25.6.0c` | no |
| 831 | Love & Sex: Second Base | `love-sex-second-base` | gsl | `25.6.0c` | no |
| 2642 | Love & Sex: Second Base | `love-sex-second-base` | gsl | `26.8.0d` | no |
| 3203 | Love & Sex: Second Base | `love-sex-second-base` | gsl | `26.9.0e` | no |
| 3352 | Love by the Water | `love-by-the-water` | gsl | `0.4RE` | no |
| 3347 | Love by the Water | `love-by-the-water` | gsl | `Demo` | no |
| 1666 | Lust Academy Season 1 | `lust-academy-season-1` | gsl | `0.4.2 - Christmas Special` | no |
| 1700 | Lust Academy Season 1 | `lust-academy-season-1` | gsl | `4.10.dlc` | no |
| 1997 | Lust Academy Season 2 | `lust-academy-season-2` | gsl | `0.4.2 - Christmas Special` | no |
| 2031 | Lust Academy Season 2 | `lust-academy-season-2` | gsl | `4.10.dlc` | no |
| 2040 | Lust Academy Season 3 | `lust-academy-season-3` | gsl | `0.4.2 - Christmas Special` | no |
| 2074 | Lust Academy Season 3 | `lust-academy-season-3` | gsl | `4.10.dlc` | no |
| 2083 | Lust Academy Season 4 | `lust-academy-season-4` | gsl | `0.4.2 - Christmas Special` | no |
| 2117 | Lust Academy Season 4 | `lust-academy-season-4` | gsl | `4.10.dlc` | no |
| 1815 | Lust Element | `lust-element` | gsl | `Season 1 Final` | yes |
| 1976 | Lust Theory Season 1 | `lust-theory-season-1` | gsl | `DLC: Part 1` | no |
| 2689 | Lust Theory Season 1 | `lust-theory-season-1` | gsl | `DLC: Part 2` | yes |
| 1100 | Lust Theory Season 2 | `lust-theory-season-2` | gsl | `DLC: Part 1` | no |
| 2686 | Lust Theory Season 2 | `lust-theory-season-2` | gsl | `DLC: Part 2` | yes |
| 2204 | Lust Theory Season 3 | `lust-theory-season-3` | gsl | `DLC: Part 1` | no |
| 2690 | Lust Theory Season 3 | `lust-theory-season-3` | gsl | `DLC: Part 2` | yes |
| 2485 | Lustful Retribution | `lustful-retribution` | gsl | `Episodes 1 & 2` | no |
| 3131 | LustyVerse: ShackBang | `lustyverse-shackbang` | gsl | `Final` | yes |
| 2383 | Magic Academy | `magic-academy` | gsl | `0.5.6.2` | no |
| 2385 | Magic Academy | `magic-academy` | gsl | `0.5.7.2` | no |
| 2389 | Magic Academy | `magic-academy` | gsl | `0.6.0.2` | no |
| 2391 | Magic Academy | `magic-academy` | gsl | `0.6.1.1` | no |
| 2394 | Magic Academy | `magic-academy` | gsl | `0.6.5.3` | no |
| 2396 | Magic Academy | `magic-academy` | gsl | `0.6.6.1` | no |
| 2397 | Magic Academy | `magic-academy` | gsl | `0.6.6.2` | no |
| 2400 | Magic Academy | `magic-academy` | gsl | `0.7.5.3` | no |
| 78 | Magic Academy | `magic-academy` | typhoon | `0.4.5.1` | no |
| 3236 | Magic Academy | `magic-academy` | typhoon | `0.7.0.1` | yes |
| 2779 | More Than A Woman | `more-than-a-woman` | gsl | `Demo` | no |
| 701 | My Bimbo Dream | `my-bimbo-dream` | gsl | `Steam S1` | yes |
| 1330 | My Bully Is My Lover | `my-bully-is-my-lover` | gsl | `Ch.1 Ep.1 P1` | no |
| 1331 | My Bully Is My Lover | `my-bully-is-my-lover` | gsl | `Ch.1 Ep.1 P2` | no |
| 1334 | My Bully Is My Lover | `my-bully-is-my-lover` | gsl | `Ch.1 Ep.3 P1` | no |
| 1335 | My Bully Is My Lover | `my-bully-is-my-lover` | gsl | `Ch.1 Ep.3 P2` | no |
| 1332 | My Bully Is My Lover | `my-bully-is-my-lover` | gsl | `Emma's Solo Ending` | no |
| 2408 | My Girlfriend's New Kink | `my-girlfriend-s-new-kink` | gsl | `0.7 Premium` | no |
| 2412 | My Girlfriend's New Kink | `my-girlfriend-s-new-kink` | gsl | `0.Z` | yes |
| 3237 | My Girlfriend's New Kink | `my-girlfriend-s-new-kink` | typhoon | `0.ZF` | yes |
| 1364 | My New Family | `my-new-family` | gsl | `Christmas Special` | yes |
| 1363 | My New Family | `my-new-family` | gsl | `Epilogue` | no |
| 1633 | Mythos Book 1 | `mythos-book-1` | gsl | `1.0.0.2` | yes |
| 3258 | Naughty Lyanna Season 1 | `naughty-lyanna-season-1` | gsl | `Season 2 - 0.26` | no |
| 3033 | Nephilim | `nephilim` | gsl | `0.6.9.5` | no |
| 3467 | Nephilim | `nephilim` | gsl | `0.6.9.7` | yes |
| 3458 | Nephilim | `nephilim` | orion | `0.6.9.5` | yes |
| 3459 | Nephilim | `nephilim` | typhoon | `0.6.9.5` | yes |
| 1349 | Nightmares of the Moon | `nightmares-of-the-moon` | gsl | `Prologue` | no |
| 226 | Not Going Back | `not-going-back` | orion | `0.4p` | no |
| 2572 | Not Going Back | `not-going-back` | orion | `0.4p` | yes |
| 89 | Not Going Back | `not-going-back` | typhoon | `0.4p` | yes |
| 1256 | Office Perks | `office-perks` | gsl | `0.0.6m-j` | no |
| 1257 | Office Perks | `office-perks` | gsl | `0.0.6m-jh` | no |
| 1258 | Office Perks | `office-perks` | gsl | `0.0.6m-jhe` | no |
| 1259 | Office Perks | `office-perks` | gsl | `0.0.6m-jheg` | no |
| 1260 | Office Perks | `office-perks` | gsl | `0.0.6m-jhegn` | no |
| 1187 | Once Again | `once-again` | gsl | `Prologue` | no |
| 205 | Once Again | `once-again` | orion | `Prologue` | no |
| 2573 | Once Again | `once-again` | orion | `Prologue` | yes |
| 265 | Once Again | `once-again` | typhoon | `Prologue` | no |
| 2508 | Once Again | `once-again` | typhoon | `Prologue` | yes |
| 1395 | Oppai Odyssey | `oppai-odyssey` | gsl | `0.2.1.7` | no |
| 1786 | Our Red String | `our-red-string` | gsl | `0.11 - Epilogue` | no |
| 1780 | Our Red String | `our-red-string` | gsl | `0.11 - Prologue` | no |
| 1784 | Our Red String | `our-red-string` | gsl | `0.11a - Epilogue` | no |
| 1778 | Our Red String | `our-red-string` | gsl | `0.11a - Prologue` | no |
| 1785 | Our Red String | `our-red-string` | gsl | `0.11b - Epilogue` | no |
| 1779 | Our Red String | `our-red-string` | gsl | `0.11b - Prologue` | no |
| 1802 | Our Red String | `our-red-string` | gsl | `0.13.3.1` | no |
| 1803 | Our Red String | `our-red-string` | gsl | `0.13.3.2` | no |
| 1804 | Our Red String | `our-red-string` | gsl | `0.13.3.3` | no |
| 1805 | Our Red String | `our-red-string` | gsl | `0.13.3.4` | no |
| 1806 | Our Red String | `our-red-string` | gsl | `0.13.3.5` | no |
| 1760 | Our Red String | `our-red-string` | gsl | `0.5 Enhanced` | no |
| 1772 | Our Red String | `our-red-string` | gsl | `0.9 Remaster Aplha` | no |
| 1773 | Our Red String | `our-red-string` | gsl | `0.9 Remaster Beta` | no |
| 1774 | Our Red String | `our-red-string` | gsl | `0.9 Remaster Final` | no |
| 1808 | Our Red String | `our-red-string` | gsl | `Ch 14.1.1 Alpha` | no |
| 1809 | Our Red String | `our-red-string` | gsl | `Ch 14.1.3` | no |
| 1810 | Our Red String | `our-red-string` | gsl | `Ch. 14.1.4b` | no |
| 1811 | Our Red String | `our-red-string` | gsl | `Ch. 14.2.1a` | no |
| 1812 | Our Red String | `our-red-string` | gsl | `Ch. 14.2.2b` | no |
| 1813 | Our Red String | `our-red-string` | gsl | `Ch. 14.2.3` | no |
| 1807 | Our Red String | `our-red-string` | gsl | `Ch.13.3.6` | no |
| 628 | Out of Touch | `out-of-touch` | gsl | `Amber & Gold P1 (Chapter 60)` | no |
| 630 | Out of Touch | `out-of-touch` | gsl | `Amber & Gold P3 (Chapter 62)` | no |
| 2655 | Out of Touch | `out-of-touch` | gsl | `Amber & Gold P4 (Ch. 63)` | no |
| 3423 | Out of Touch | `out-of-touch` | gsl | `Amber & Gold P5` | yes |
| 588 | Out of Touch | `out-of-touch` | gsl | `Ch. 20+21` | no |
| 589 | Out of Touch | `out-of-touch` | gsl | `Ch. 22+23` | no |
| 619 | Out of Touch | `out-of-touch` | gsl | `Ch. 50+51` | no |
| 629 | Out of Touch | `out-of-touch` | gsl | `Gold & Amber P2 (Chapter 61)` | no |
| 581 | Out of Touch | `out-of-touch` | gsl | `Prologue Remake` | no |
| 2940 | Pale Carnations | `pale-carnations` | orion | `Chapter 4Up6Public` | no |
| 2981 | Pale Carnations | `pale-carnations` | typhoon | `Chapter 4Up6Public` | no |
| 2667 | Paper Hearts | `paper-hearts` | gsl | `Chapter 7: The Definitive Story Overhaul` | yes |
| 397 | Perfect Son-In-Law: Hidden S-Rank | `perfect-son-in-law-hidden-s-rank` | gsl | `Act 3 & 4 Beta` | no |
| 396 | Perfect Son-In-Law: Hidden S-Rank | `perfect-son-in-law-hidden-s-rank` | gsl | `Demo Beta` | no |
| 1204 | Perverted Tea House | `perverted-tea-house` | gsl | `0.1.1c` | yes |
| 2633 | Perverted Tea House | `perverted-tea-house` | orion | `0.1.1C` | yes |
| 2619 | Perverted Tea House | `perverted-tea-house` | typhoon | `0.1.1C` | yes |
| 2478 | Photo Hunt | `photo-hunt` | gsl | `0.18.1 Extra` | no |
| 3378 | Portal Heart Part Two | `portal-heart-part-two` | gsl | `Pt. Two 1.2` | no |
| 1280 | Price of Power | `price-of-power` | gsl | `Epilogue 1` | no |
| 1283 | Price of Power | `price-of-power` | gsl | `Epilogue 5` | yes |
| 1281 | Price of Power | `price-of-power` | gsl | `Epilouge 2` | no |
| 1282 | Price of Power | `price-of-power` | gsl | `Epilouge 3` | no |
| 901 | Profiler | `profiler` | gsl | `0.4.3.1` | yes |
| 191 | Profiler | `profiler` | orion | `0.4.3.1` | no |
| 2585 | Profiler | `profiler` | orion | `0.4.3.1` | yes |
| 104 | Profiler | `profiler` | typhoon | `0.4.3.1` | yes |
| 3011 | Pulse | `pulse` | gsl | `TBA` | yes |
| 2735 | Reclaim the Fame | `reclaim-the-fame` | gsl | `Demo` | no |
| 2736 | Reclaim the Fame | `reclaim-the-fame` | gsl | `Final` | yes |
| 864 | Ripples | `ripples` | gsl | `0.1.0 Remaster` | no |
| 2169 | Rivers of Astrum: Daughter of Darkness | `rivers-of-astrum-daughter-of-darkness` | gsl | `0.2.1.5 - Public` | no |
| 1816 | Sanguine Rose | `sanguine-rose` | gsl | `4.1 Lost Chapters` | yes |
| 847 | Saviour of the Wasteland | `saviour-of-the-wasteland` | gsl | `1.0.3 Steam + DLC` | yes |
| 157 | Sellsword Tales | `sellsword-tales` | orion | `0.1.8.7` | no |
| 2591 | Sellsword Tales | `sellsword-tales` | orion | `0.1.8.7` | yes |
| 114 | Sellsword Tales | `sellsword-tales` | typhoon | `0.1.8.7` | yes |
| 110 | Sissy Home of Evelyn | `husbands-of-evelyn` | typhoon | `0.10.0c` | yes |
| 967 | Steps of Debauchery | `steps-of-debauchery` | gsl | `5.0 - 12.12` | no |
| 2488 | Stormside | `stormside` | gsl | `0.23.1.4` | no |
| 2682 | Stormside | `stormside` | gsl | `0.23.2.2` | yes |
| 118 | Stormside | `stormside` | typhoon | `0.23.1.4` | yes |
| 1180 | Stranded In Space | `stranded-in-space` | gsl | `Days 1-19 Complete` | no |
| 2943 | Stray Incubus: Season 2 | `stray-incubus-season-2` | orion | `Season 2 Chapter 2a` | no |
| 167 | Stray Incubus: Season 2 | `stray-incubus-season-2` | orion | `Season 2 Chapter 3b` | no |
| 2593 | Stray Incubus: Season 2 | `stray-incubus-season-2` | orion | `Season 2 Chapter 3b` | yes |
| 2984 | Stray Incubus: Season 2 | `stray-incubus-season-2` | typhoon | `Season 2 Chapter 2a` | no |
| 252 | Stray Incubus: Season 2 | `stray-incubus-season-2` | typhoon | `Season 2 Chapter 3b` | no |
| 2512 | Stray Incubus: Season 2 | `stray-incubus-season-2` | typhoon | `Season 2 Chapter 3b` | yes |
| 1490 | Summer's Gone - Season 1 | `summer-s-gone` | gsl | `0.4.5.beta` | no |
| 1491 | Summer's Gone - Season 1 | `summer-s-gone` | gsl | `0.4.5.full` | no |
| 1492 | Summer's Gone - Season 1 | `summer-s-gone` | gsl | `0.5.0.beta` | no |
| 1494 | Summer's Gone - Season 1 | `summer-s-gone` | gsl | `Season 2: Chapters 1-3 Beta` | no |
| 1495 | Summer's Gone - Season 1 | `summer-s-gone` | gsl | `Season 2: Chapters 1-3 Final` | yes |
| 380 | Summer's Gone - Season 2 - Constellations | `summer-s-gone-season-2-constellations` | gsl | `0.4.5.beta` | no |
| 381 | Summer's Gone - Season 2 - Constellations | `summer-s-gone-season-2-constellations` | gsl | `0.4.5.full` | no |
| 382 | Summer's Gone - Season 2 - Constellations | `summer-s-gone-season-2-constellations` | gsl | `0.5.0.beta` | no |
| 384 | Summer's Gone - Season 2 - Constellations | `summer-s-gone-season-2-constellations` | gsl | `Season 2: Chapters 1-3 Beta` | no |
| 385 | Summer's Gone - Season 2 - Constellations | `summer-s-gone-season-2-constellations` | gsl | `Season 2: Chapters 1-3 Final` | yes |
| 723 | Survivor Strain | `survivor-strain` | gsl | `S.1 v0.9.9.8` | yes |
| 3393 | Tainted Harmony: A Succubus\`s Embrace | `tainted-harmony-a-succubus-s-embrace` | gsl | `0.2.1.1` | no |
| 1009 | Tales from the Unending Void Season 1 | `tales-from-the-unending-void-season-1` | gsl | `0.21 Extra` | no |
| 3096 | Tales From The Unending Void: Season 2 | `tales-from-the-unending-void-season-2` | gsl | `0.21 Extra` | no |
| 3270 | Tales of Legendary Lust: Aphrodisia | `tales-of-legendary-lust-aphrodisia` | orion | `Build 2E` | yes |
| 3271 | Tales of Legendary Lust: Aphrodisia | `tales-of-legendary-lust-aphrodisia` | typhoon | `Build 2E` | yes |
| 1344 | The Assistant Episode 1 | `the-assistant-episode-1` | gsl | `Final` | yes |
| 1343 | The Assistant Episode 1 | `the-assistant-episode-1` | gsl | `Final P1` | no |
| 975 | The Assistant Episode 2 | `the-assistant-episode-2` | gsl | `Final` | yes |
| 974 | The Assistant Episode 2 | `the-assistant-episode-2` | gsl | `Final P1` | no |
| 1980 | The Entrepeneur | `the-entrepeneur` | gsl | `Complete Edition` | yes |
| 244 | The Fiery Scion | `the-fiery-scion` | typhoon | `Update 32a` | no |
| 2513 | The Fiery Scion | `the-fiery-scion` | typhoon | `Update 32a` | yes |
| 727 | The Inn | `the-inn` | gsl | `1.02.01-2` | yes |
| 134 | The Last Barbarian Rebirth | `the-last-barbarian-rebirth` | typhoon | `0.6.5.1` | no |
| 533 | The Last Embrace | `the-last-embrace` | gsl | `0.1.1_bugfix` | no |
| 532 | The Last Embrace | `the-last-embrace` | gsl | `0.1.2_prologue` | no |
| 531 | The Last Embrace | `the-last-embrace` | gsl | `0.1_prologue` | no |
| 534 | The Last Embrace | `the-last-embrace` | gsl | `0.2_ch1` | no |
| 537 | The Last Embrace | `the-last-embrace` | gsl | `0.3.5 Demo` | no |
| 539 | The Last Embrace | `the-last-embrace` | gsl | `0.4.1_ch3` | no |
| 538 | The Last Embrace | `the-last-embrace` | gsl | `0.4_ch3` | no |
| 540 | The Last Embrace | `the-last-embrace` | gsl | `0.5_ch4` | no |
| 542 | The Last Embrace | `the-last-embrace` | gsl | `0.6.1_ch5` | yes |
| 541 | The Last Embrace | `the-last-embrace` | gsl | `0.6_ch5` | no |
| 2419 | The Lusanti Chronicles | `the-lusanti-chronicles` | gsl | `Chapter 1 - 1.0` | no |
| 1548 | The Missing Part | `the-missing-part` | gsl | `Prologue` | no |
| 2947 | The Missing Part | `the-missing-part` | orion | `Chapter 4 original new` | no |
| 2988 | The Missing Part | `the-missing-part` | typhoon | `Chapter 4 original new` | no |
| 2904 | The Power of Truth - Book 1 | `the-power-of-truth-book-1` | gsl | `0.0.9.0` | no |
| 2905 | The Power of Truth - Book 1 | `the-power-of-truth-book-1` | gsl | `0.0.9.1` | no |
| 1366 | The Seven Realms - Realm 1: Terran | `the-seven-realms-realm-1-terran` | gsl | `E3 1.03` | no |
| 2147 | The Seven Realms - Realm 2: Pythonium | `the-seven-realms-realm-2-pythonium` | gsl | `E3 1.03` | no |
| 2173 | The Seven Realms - Realm 3: High Lathión | `the-seven-realms-realm-3-high-lathion` | gsl | `E3 1.03` | no |
| 1655 | The Seven Realms - Realm 4: Syren'Hal | `the-seven-realms-realm-4-syren-hal` | gsl | `E3 1.03` | no |
| 2706 | The Spellbook | `the-spellbook` | gsl | `0.20.5.0` | no |
| 2709 | The Spellbook | `the-spellbook` | gsl | `0.22.5.0` | yes |
| 2907 | The Velan Reach - Book One: An Unbroken Line | `the-velan-reach-book-one-an-unbroken-line` | gsl | `Demo` | no |
| 2693 | Thirty Days | `thirty-days` | gsl | `0.09.01M.POL` | no |
| 2695 | Thirty Days | `thirty-days` | gsl | `0.09.05M Full` | no |
| 2696 | Thirty Days | `thirty-days` | gsl | `0.10.8.3` | yes |
| 2694 | Thirty Days | `thirty-days` | gsl | `9.02M.POL` | no |
| 524 | True Love: The Game | `true-love-the-game` | gsl | `Chapter 1 - 0.1` | no |
| 2461 | University of Problems | `university-of-problems` | gsl | `1.5.0 Remake` | no |
| 2465 | University of Problems | `university-of-problems` | gsl | `1.7.0 Extended` | no |
| 1352 | Valhalla: Lilith Rising | `valhalla-lilith-rising` | gsl | `3.0.7s` | yes |
| 3387 | Vox Gremory | `vox-gremory` | gsl | `R16S2` | no |
| 926 | Wet Nightmares | `wet-nightmares` | gsl | `Chapter 2 - 3.11` | no |

## Rows with no reported version

These records cannot be normalized from `reported_version`; inspect the source or manifest before choosing a value.

| Row ID | Game | Slug | Source | Current | Parse error |
|---:|---|---|---|:---:|---|
| 2 | 30 Days | `30-days` | typhoon | no | No version-like token found in Game Directory |
| 4 | Actual Roommates 2 | `actual-roommates-2` | typhoon | no | No version-like token found in Game Directory |
| 5 | Actual Roommates Gaiden | `actual-roommates-gaiden` | typhoon | no | No version-like token found in Game Directory |
| 3163 | Anna Exciting Affection - Chapter 1 | `anna-exciting-affection-chapter-1` | typhoon | no | no version-like token remained after platform cleanup |
| 19 | Bound by Blood | `bound-by-blood` | typhoon | no | No version-like token found in Game Directory |
| 21 | Chronicles of Hell and Heaven | `chronicles-of-hell-and-heaven` | typhoon | no | No version-like token found in Game Directory |
| 22 | Chronicles of Kartoba | `chronicles-of-kartoba` | typhoon | no | No version-like token found in Game Directory |
| 23 | Color of My Sound | `color-of-my-sound` | typhoon | no | No version-like token found in Game Directory |
| 24 | Companion of Darkness Season 1 | `companion-of-darkness-season-1` | typhoon | no | No version-like token found in Game Directory |
| 25 | Companion of Darkness Season 2 | `companion-of-darkness-season-2` | typhoon | no | No version-like token found in Game Directory |
| 35 | Dilemma of Devotion | `dilemma-of-devotion` | typhoon | no | No version-like token found in Game Directory |
| 37 | Driven By Desire | `driven-by-desire` | typhoon | no | No version-like token found in Game Directory |
| 2818 | Eclipsis | `eclipsis` | orion | no | no version-like token remained after platform cleanup |
| 2819 | Eclipsis | `eclipsis` | typhoon | no | no version-like token remained after platform cleanup |
| 40 | Empire of Heroes | `empire-of-heroes` | typhoon | no | No version-like token found in Game Directory |
| 48 | Glass Half Broken | `glass-half-broken` | typhoon | no | No version-like token found in Game Directory |
| 50 | God of the Sun | `god-of-the-sun` | typhoon | no | No version-like token found in Game Directory |
| 3022 | Hearts on Parole | `hearts-on-parole` | orion | no | no version-like token remained after platform cleanup |
| 3023 | Hearts on Parole | `hearts-on-parole` | typhoon | no | no version-like token remained after platform cleanup |
| 59 | High Desire | `high-desire` | typhoon | no | No version-like token found in Game Directory |
| 2816 | House of Hearts | `house-of-hearts` | orion | no | no version-like token remained after platform cleanup |
| 61 | House of Hearts | `house-of-hearts` | typhoon | no | No version-like token found in Game Directory |
| 2817 | House of Hearts | `house-of-hearts` | typhoon | no | no version-like token remained after platform cleanup |
| 74 | Lisa Total Investigation! | `lisa-total-investigation` | typhoon | no | No version-like token found in Game Directory |
| 81 | My Bully Is My Lover | `my-bully-is-my-lover` | typhoon | no | No version-like token found in Game Directory |
| 83 | Myth of Slayer | `myth-of-slayer` | typhoon | no | No version-like token found in Game Directory |
| 92 | Once Again | `once-again` | typhoon | no | No version-like token found in Game Directory |
| 98 | Pale Carnations | `pale-carnations` | typhoon | no | No version-like token found in Game Directory |
| 103 | Price of Power | `price-of-power` | typhoon | no | No version-like token found in Game Directory |
| 106 | Realm Invader | `realm-invader` | typhoon | no | No version-like token found in Game Directory |
| 2592 | Stray Incubus: Season 1 | `stray-incubus-season-1` | orion | yes | no version-like token remained after platform cleanup |
| 115 | Stray Incubus: Season 1 | `stray-incubus-season-1` | typhoon | yes | no version-like token remained after platform cleanup |
| 116 | Stray Incubus: Season 2 | `stray-incubus-season-2` | typhoon | no | No version-like token found in Game Directory |
| 123 | The Fiery Scion | `the-fiery-scion` | typhoon | no | No version-like token found in Game Directory |
| 126 | The Missing Part | `the-missing-part` | typhoon | no | No version-like token found in Game Directory |
| 130 | The Nature of Magic | `the-nature-of-magic` | typhoon | no | No version-like token found in Game Directory |
| 141 | V.I.R.T.U.E.S. | `v-i-r-t-u-e-s` | typhoon | no | No version-like token found in Game Directory |
| 144 | Young Again | `young-again` | typhoon | no | No version-like token found in Game Directory |

## Totals by source

| Source | Labeled rows needing review |
|---|---:|
| gsl | 315 |
| orion | 35 |
| typhoon | 54 |
