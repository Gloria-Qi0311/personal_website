# antares-cv

Antares Yuan's resume in your terminal.

```bash
npx antares-cv
```

Fetches live content from <https://antaresyuan.site/content/*.json>, so it always matches what's on the website.

## Options

```
--full       include card summaries + lens asides
--json       structured JSON output (for piping)
--no-color   plain text, no ANSI
--help, -h   help
```

## Pipe-friendly examples

```bash
# pretty-print on a slow link with no colors:
npx antares-cv --no-color | less

# query specific data with jq:
npx antares-cv --json | jq '.board.shipped[].title'
npx antares-cv --json | jq '.contact[] | select(.key=="email") | .href'
```

## Zero deps

Uses Node 18+ built-in `fetch` and inline ANSI escape codes. The whole CLI is a single ~150-line file.

## Publishing (maintainer)

```bash
cd cli/
npm publish --access public
```

The `bin` entry resolves to `./cv.js`, so once published, anyone can run `npx antares-cv` without installing anything.

## Source

<https://github.com/AntaresYuan/personal_website> — single repo containing the website, the CMS config, the build scripts, and this CLI.
