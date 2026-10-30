# Offbeat

A Windows screenwriting app in the spirit of [Beat](https://github.com/lmparppei/Beat) for macOS. It writes plain-text [Fountain](https://fountain.io) screenplays, formats them as you type, and prints industry-standard PDFs. Files open in Beat on Mac and iOS and back again — Beat's per-document settings are preserved untouched.

Offbeat is an independent, from-scratch implementation (Electron + CodeMirror); it is not affiliated with Beat or its author.

## Install (Windows 10/11, 64-bit)

Download the latest version from the [Releases page](https://github.com/patcrowley/offbeat/releases):

- **Offbeat-Setup-x.y.z.exe** installs Offbeat for your user account (no admin rights needed), adds Start-menu and desktop shortcuts, and opens `.fountain` files on double-click. Remove it from Settings → Apps.
- **Offbeat-Portable-x.y.z.exe** runs without installing, from any folder or a USB stick. Its settings, backups and personal dictionary are kept in an `Offbeat Data` folder next to the exe, so they travel with it.

The app isn't code-signed, so the first launch may show **Windows protected your PC**. Choose **More info → Run anyway**.

## What's in it

**Writing**
- Live screenplay formatting on a true-to-scale page: scene headings, action, character cues, parentheticals, dialogue, transitions, centered text, lyrics, dual dialogue
- Scene numbers in both margins, page breaks shown as real gaps between sheets
- Auto-capitalized scene headings; **Tab** on an empty line starts a character cue, **Tab** under a cue adds a parenthetical
- Smart line breaks: Enter after dialogue/action adds the blank line for you, **Shift+Enter** for a single break
- Autocomplete for character names and locations (and DAY/NIGHT after the dash)
- Bold, italic, underline, notes, boneyard; force any element type
- Find & replace, go-to-scene palette
- Spell check that works offline (US or UK English): red underlines as you type, right-click for suggestions, and **F7** to review every flagged word with Change, Change all, Ignore all and Add to dictionary. Character names, contractions, emails, notes markup and omitted text are skipped. Your added words live in a personal dictionary (Settings → Open Personal Dictionary)
- Light/dark mode (or follow Windows), dim markup, typewriter scrolling, script zoom
- **Interface size** (View → Interface Size, 75%–200%) makes everything bigger or smaller: menus, sidebar, dialogs and the script. In a narrow window the script keeps the size you chose and wraps lines a little earlier, instead of shrinking. PDFs and printouts are never affected
- **Editor fonts** (View → Editor Font): Courier Prime, Courier New, IBM Plex Mono, Atkinson Hyperlegible Mono (designed for low vision) and OpenDyslexic (designed for dyslexia). This only changes how the script looks while you write
- **Reopens your last script** where you left off, with the same cursor position (Settings → Reopen Last Script on Startup)
- Backups of every saved version (File → Show Backups Folder) and optional autosave

**Structure**
- Outline sidebar with sections, synopses, page numbers and a filter (by text, character, scene number or color)
- Index cards — double-click a card to edit its heading and synopsis right there (Enter saves, Esc cancels), drag to reorder scenes, right-click to color, and add new cards at the end of any act or after the selected card. Select several cards with Ctrl+click, Shift+click or Ctrl+A, then use **Move to act** (or right-click) to send them all to the end of another act, or drag any one of them to move the group. Selected cards can be recolored together, and Ctrl+Z undoes the whole move. Each card has a button to open that scene in the script
- Timeline strip with scene lengths to scale
- Scene colors use Beat's syntax: `INT. HOUSE - DAY [[COLOR RED]]`

**Output**
- Paginated print preview; PDF export with embedded Courier Prime; direct printing
- Proper pagination: 54 lines per page on Letter, (MORE)/(CONT'D) dialogue splits, headings never orphaned at a page bottom, US Letter or A4
- PDF and print font: Courier Prime or Courier New (Settings → PDF and Print Font). Both are standard 12-point Courier, so page counts don't change
- Title page editor
- Final Draft `.fdx` import and export (styles, scene numbers, dual dialogue, title page)
- HTML export
- Statistics: pages, scenes, words, rough runtime, INT/EXT and day/night split, dialogue per character, locations

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New / Open / Save / Save As | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Export PDF / Print | Ctrl+Shift+E / Ctrl+P |
| Print preview | Ctrl+E |
| Outline / Index cards / Timeline | Ctrl+Shift+O / Ctrl+Shift+K / Ctrl+Shift+L |
| Statistics / Title page | Ctrl+Shift+I / Ctrl+Shift+T |
| Go to scene | Ctrl+G |
| New card (scene) | Ctrl+Shift+Enter |
| Find / Replace / Find next | Ctrl+F / Ctrl+H / F3 |
| Check spelling | F7 |
| Bold / Italic / Underline | Ctrl+B / Ctrl+I / Ctrl+U |
| Note / Omit | Ctrl+Shift+N / Ctrl+Shift+B |
| Force heading, action, character, transition, lyrics, centered | Ctrl+Alt+1 … 6 |
| Dual dialogue | Ctrl+Shift+D |
| Dim markup | Ctrl+Shift+M |
| Interface size larger / smaller | Ctrl+Shift+= / Ctrl+Shift+- |
| Script zoom | Ctrl+= / Ctrl+- / Ctrl+0 |

**Help → Fountain Syntax Guide** opens a cheat sheet written as a screenplay, and **Help → Open Sample Screenplay** shows every feature in use.

## Build from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm start          # run in development
npm test           # parser/pagination/FDX unit tests
npm run dist       # builds dist\Offbeat-Setup-<version>.exe and dist\Offbeat-Portable-<version>.exe
```

On Linux or macOS, building the Windows installer and portable exe needs Wine (with 32-bit support). Icon and version info are stamped into `Offbeat.exe` by `scripts/stamp-exe.js` on any OS.

## Project layout

```
main.js              Electron main process: windows, menus, files, PDF, backups, prefs
preload.js           Safe bridge between the window and the main process
src/core/fountain.js Fountain parser (line classification, elements, outline)
src/core/paginate.js Pagination and print/PDF rendering
src/core/fdx.js      Final Draft import/export and statistics
src/app.js           Editor: formatting, smart keys, autocomplete, commands
src/views.js         Outline, index cards, timeline, preview, dialogs
src/mode.js          Inline syntax styling for the editor
test/                Unit tests and end-to-end app tests
```

## Releasing a new version

1. Update `version` in `package.json` and commit.
2. Tag and push: `git tag v1.0.3 && git push origin main --tags`.
3. GitHub Actions (`.github/workflows/release.yml`) builds the installer and portable exe on Windows and attaches them to a new release.

## Contributing

Bug reports and pull requests are welcome. Please read the [code of conduct](CODE_OF_CONDUCT.md) first. Run `npm test` before opening a pull request.

## Credits and license

Offbeat is inspired by [Beat](https://github.com/lmparppei/Beat) by Lauri-Matti Parppei, the free, open-source screenwriting app for macOS and iOS. Offbeat contains none of Beat's code; it reads and writes the same Fountain conventions (such as `[[COLOR RED]]` scene colors and Beat's document settings block) so files move freely between the two apps. If you're on a Mac, use Beat.

Offbeat is free software under the [GNU General Public License v3.0 or later](LICENSE), the same license as Beat. You may use, share and modify it; if you distribute a modified version, it must also be released under the GPL with its source code. Bundled components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
