---
name: self-contained-python-scripts
description: |
  Create self-contained Python scripts that run with `uv run --script`. Covers PEP 723
  inline metadata, ergonomic CLI design (argparse / Cyclopts), rich output formatting,
  progress bars (alive-progress), interactive prompts (questionary), and fuzzy selection
  (iterfzf). Use when asked to create a Python script, CLI tool, or automation script.
user-invocable: false
---

# Self-Contained Python Scripts with `uv`

Create Python scripts that are fully self-contained — no virtualenv setup, no `requirements.txt`, no `pyproject.toml`. Just a single `.py` file that anyone can run with `uv run`.

## Script Structure

Every script follows this structure:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "some-package",
# ]
# ///

"""One-line description of what this script does."""

# imports and code here
```

### Rules

1. **Shebang**: Always `#!/usr/bin/env -S uv run --script` as the first line.
2. **Inline metadata**: PEP 723 block immediately after the shebang.
3. **`requires-python`**: Always specify. Default to `>= 3.14` unless the user specifies otherwise.
4. **Maximum Python version**: If a dependency is known to be incompatible with a newer Python version, add an upper bound (e.g., `requires-python = ">=3.14,<3.15"`).
5. **Dependencies**: List all third-party imports in the `dependencies` array.

---

## PEP 723 Inline Script Metadata

The metadata block uses TOML syntax, prefixed with `# ` on every line:

```python
# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "requests>=2.31",
#   "rich",
# ]
# ///
```

### Syntax Rules

- Opening line: exactly `# /// script`
- Closing line: exactly `# ///`
- Every interior line starts with `#` followed by a space (if content follows)
- Content is TOML with the `# ` prefix stripped
- Only one `script` block per file

### Supported Fields

| Field | Type | Description |
|-------|------|-------------|
| `requires-python` | `str` | Version specifier (e.g., `">=3.14"`) |
| `dependencies` | `list[str]` | PEP 508 dependency specifiers |
| `[tool.*]` | table | Tool-specific config (same as `pyproject.toml`) |

### Examples

Minimal (no dependencies):
```python
# /// script
# requires-python = ">=3.14"
# ///
```

With pinned versions:
```python
# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "httpx>=0.27,<1",
#   "rich>=13",
#   "pydantic>=2,<3",
# ]
# ///
```

---

## CLI Design

All scripts MUST have a CLI interface. The choice of CLI framework depends on complexity.

### Simple Scripts: `argparse`

Use `argparse` for scripts with a flat set of arguments (no subcommands). This is the default unless the user asks for something else.

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///

"""Resize images in a directory."""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Source directory")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output directory (default: source/resized)")
    parser.add_argument("-w", "--width", type=int, default=800, help="Target width in pixels (default: 800)")
    parser.add_argument("--quality", type=int, default=85, choices=range(1, 101), metavar="1-100", help="JPEG quality (default: 85)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print detailed output")
    args = parser.parse_args()

    output = args.output or args.source / "resized"
    # ... implementation ...


if __name__ == "__main__":
    main()
```

### Complex Scripts: Cyclopts

Use [Cyclopts](https://cyclopts.readthedocs.io) for scripts with **multiple commands or subcommand groups**. Cyclopts uses Python's native type hints for argument parsing — no `Argument()` / `Option()` wrappers needed.

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "cyclopts>=4",
# ]
# ///

"""Project scaffolding tool."""

from pathlib import Path
from typing import Annotated, Literal

from cyclopts import App, Parameter, validators

app = App(name="scaffold", help=__doc__, version="1.0.0")


@app.command
def init(
    path: Path = Path("."),
    template: Literal["default", "minimal", "full"] = "default",
    *,
    force: bool = False,
):
    """Initialize a new project.

    Parameters
    ----------
    path
        Directory to initialize.
    template
        Project template to use.
    force
        Overwrite existing files.
    """
    print(f"Initializing {template!r} project at {path}")


# ── Subcommand group ──────────────────────────────────────

db = app.command(App(name="db", help="Database operations."))


@db.command
def migrate(*, dry_run: bool = False):
    """Run pending migrations.

    Parameters
    ----------
    dry_run
        Show SQL without executing.
    """
    print(f"{'[DRY RUN] ' if dry_run else ''}Running migrations...")


@db.command
def seed(
    count: Annotated[int, Parameter(validator=validators.Number(gte=1))] = 10,
    *,
    table: str | None = None,
):
    """Seed the database with test data.

    Parameters
    ----------
    count
        Number of records to insert.
    table
        Specific table to seed (all if omitted).
    """
    target = f"table {table!r}" if table else "all tables"
    print(f"Seeding {count} records into {target}")


if __name__ == "__main__":
    app()
```

#### Cyclopts Key Patterns

```python
from cyclopts import App, Parameter, validators
from typing import Annotated, Literal

app = App(name="tool", help="...", version="1.0.0")

# Default action (no subcommand given)
@app.default
def main(): app.help_print()

# Command (name auto-derived: foo_bar -> foo-bar)
@app.command
def foo_bar(): ...

# Subcommand group
sub = app.command(App(name="sub", help="..."))
@sub.command
def action(): ...

# Positional-only (no --flag generated)
def cmd(src: Path, dst: Path, /): ...

# Keyword-only (must use --flag)
def cmd(*, verbose: bool = False): ...

# Short alias
output: Annotated[str, Parameter(alias="-o")] = "out"

# Validator
port: Annotated[int, Parameter(validator=validators.Number(gte=1, lte=65535))] = 8080

# Choices
fmt: Literal["json", "yaml", "toml"] = "json"

# Entry point
if __name__ == "__main__":
    app()
```

> **Cyclopts vs Typer**: Cyclopts uses Python's `/` and `*` markers for positional vs keyword. No `Argument()` / `Option()` needed. Decorator parentheses are optional: `@app.command` works without `()`.

---

## Rich Output Formatting

Use [Rich](https://rich.readthedocs.io) when the script benefits from formatted terminal output (tables, panels, syntax highlighting, styled text).

```python
# dependencies = ["rich"]

from rich.console import Console
from rich.table import Table
from rich import print  # drop-in replacement for print()

console = Console()
console.print("[bold green]Success![/] Operation completed.")

table = Table(title="Results")
table.add_column("Name", style="cyan")
table.add_column("Status", style="green")
table.add_row("item-1", "OK")
console.print(table)
```

Only add `rich` as a dependency when formatted output provides clear value. Plain `print()` is fine for simple scripts.

---

## Progress Bars: `alive-progress`

Use [alive-progress](https://github.com/rsalmei/alive-progress) when a script performs a loop over many items or a long-running operation. **Do NOT use a progress bar for tasks expected to complete in under 2 seconds.**

```python
# dependencies = ["alive-progress"]
from alive_progress import alive_bar
```

### Basic Usage

```python
with alive_bar(len(items), title="Processing") as bar:
    for item in items:
        process(item)
        bar()
```

### Full-Featured Example

```python
with alive_bar(
    len(files),
    title="Uploading",
    unit="files",
    dual_line=True,
) as bar:
    for f in files:
        bar.text = f"-> {f.name}"
        upload(f)
        bar()
```

### Key Parameters

| Parameter | Type | Default | Use When |
|-----------|------|---------|----------|
| `total` | `int \| None` | `None` | **Always specify** when the count is known. `None` = unknown/streaming mode (no ETA). |
| `title` | `str \| None` | `None` | **Always provide** a short, descriptive label (shown left of bar). |
| `unit` | `str` | `""` | Items have a natural unit (`"files"`, `"rows"`, `"req"`, `"B"`). |
| `scale` | `str \| None` | `None` | Byte-like units: `"SI"` (1000-based), `"IEC"` (1024-based, KiB/MiB/GiB). |
| `dual_line` | `bool` | `False` | `bar.text` messages are long and would clutter the bar line. |
| `spinner` | `str \| None` | from theme | Override spinner style. Named strings: `classic`, `dots`, `waves`, `pulse`, etc. |
| `bar` | `str \| None` | from theme | Override bar fill style: `smooth`, `classic`, `blocks`, `bubbles`, etc. |
| `theme` | `str` | `"smooth"` | Preset bundle of spinner + bar + unknown style. Options: `smooth`, `classic`, `scuba`, `musical`. |
| `manual` | `bool` | `False` | You know the percentage but not item count. Call `bar(0.0-1.0)`. |
| `force_tty` | `bool \| None` | `None` | `True` for PyCharm/Jupyter. `False` for CI (receipt only). |
| `receipt_text` | `bool` | `False` | `True` to show the last `bar.text` in the final summary line. |

### The `bar` Handle

```python
with alive_bar(total, title="Work") as bar:
    bar()                        # advance by 1
    bar(5)                       # advance by 5
    bar.text = "current status"  # situational message (inline or second line with dual_line)
    bar.title = "Phase 2"        # update the left-side title mid-run
    bar.current                  # read current count
```

### Operating Modes

| `total` | `manual` | Mode | `bar()` call |
|---------|----------|------|-------------|
| provided | `False` | **Auto** (default) | `bar()` increments by 1 |
| `None` | `False` | **Unknown** | `bar()` increments (no ETA, animated) |
| provided | `True` | **Manual** | `bar(0.0-1.0)` sets percentage |

### Iterator Shortcut

```python
from alive_progress import alive_it

for item in alive_it(items, title="Processing"):
    process(item)
```

### Common Patterns

```python
# ── Bytes with IEC scaling ─────────────────────────────────
with alive_bar(file_size, unit="B", scale="IEC", title="Download") as bar:
    for chunk in stream:
        write(chunk)
        bar(len(chunk))

# ── Unknown total (streaming) ──────────────────────────────
with alive_bar(title="Reading stream") as bar:
    for record in stream:
        process(record)
        bar()

# ── Manual percentage ──────────────────────────────────────
steps = ["fetch", "transform", "load"]
with alive_bar(manual=True, title="Pipeline") as bar:
    for i, step in enumerate(steps):
        bar.text = step
        run(step)
        bar((i + 1) / len(steps))
```

### Gotchas

- **No nesting**: Do not nest `with alive_bar()` blocks. Use sequential bars instead.
- **`total` must be `int`**: Not float. Cast if needed: `alive_bar(int(total))`.
- `bar()` outside the `with` block is silently ignored.
- `print()` inside the `with` block works correctly — alive-progress hooks stdout and renders print output above the bar.
- `bar.text` is not shown in the final receipt unless `receipt_text=True`.

---

## Interactive Prompts: `questionary`

Use [questionary](https://questionary.readthedocs.io) when the script needs user input beyond simple CLI arguments. **ALWAYS provide a CLI argument alternative** so the script can run non-interactively (e.g., in CI).

```python
# dependencies = ["questionary"]
import questionary
```

### Pattern: CLI Args with Interactive Fallback

```python
def get_config(args: argparse.Namespace) -> dict:
    """Resolve config from CLI args, falling back to interactive prompts."""
    name = args.name or questionary.text("Project name?", default="my-project").ask()
    template = args.template or questionary.select(
        "Template?",
        choices=["default", "minimal", "full"],
    ).ask()
    return {"name": name, "template": template}
```

### Prompt Types

#### `text` — free-form input
```python
name = questionary.text("Your name?", default="World").ask()
```

#### `password` — masked input
```python
secret = questionary.password("API key?").ask()
```

#### `confirm` — yes/no
```python
proceed = questionary.confirm("Continue?", default=True).ask()
```

#### `select` — pick one (arrow keys)
```python
choice = questionary.select(
    "Environment?",
    choices=["development", "staging", "production"],
    default="development",
).ask()
```

#### `checkbox` — pick many (Space to toggle)
```python
selected = questionary.checkbox(
    "Features to enable?",
    choices=["auth", "logging", "metrics", "tracing"],
).ask()
```

#### `path` — file/directory with Tab completion
```python
config = questionary.path("Config file?", default="./config.yaml").ask()
```

#### `autocomplete` — text with suggestions
```python
lang = questionary.autocomplete(
    "Language?",
    choices=["Python", "Rust", "Go", "TypeScript", "Java"],
).ask()
```

### Choice Objects

```python
from questionary import Choice, Separator

choices = [
    Choice("Production", value="prod"),
    Choice("Staging", value="staging"),
    Separator("--- Dev ---"),
    Choice("Local", value="local"),
    Choice("Docker", value="docker", disabled="Not available"),
]
```

### Validation

```python
questionary.text(
    "Port?",
    validate=lambda v: True if v.isdigit() and 1 <= int(v) <= 65535 else "Must be 1-65535",
).ask()
```

### Return Value

All `.ask()` calls return `None` if the user cancels with Ctrl-C. Always handle this:

```python
name = questionary.text("Name?").ask()
if name is None:
    print("Cancelled.")
    raise SystemExit(1)
```

---

## Fuzzy Selection: `iterfzf`

Use [iterfzf](https://github.com/dahlia/iterfzf) when the user needs to select from a large list with fuzzy search. `fzf` is bundled in the package — no separate install needed.

```python
# dependencies = ["iterfzf"]
from iterfzf import iterfzf
```

### Basic Usage

```python
# Single selection
choice = iterfzf(["apple", "banana", "cherry", "date"])

# Multi-selection (Tab to toggle)
selected = iterfzf(
    ["alpha", "beta", "gamma", "delta"],
    multi=True,
    prompt="Pick items > ",
)
```

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `multi` | `False` | `True` = multi-select with Tab. Returns `list[str]`. |
| `prompt` | `" >"` | Prompt string shown in fzf UI. |
| `query` | `""` | Pre-filled search query. |
| `exact` | `False` | `True` = exact substring match instead of fuzzy. |
| `case_sensitive` | `None` | `True`/`False`/`None` (smart-case). |
| `preview` | `None` | Shell command for preview pane (e.g., `"cat {}"`). |
| `header` | `None` | Sticky header text below the prompt. |
| `ansi` | `None` | `True` to render ANSI colors in items. |

### Return Types

| `multi` | User selects | User cancels (Esc) |
|---------|--------------|--------------------|
| `False` | `str` | `None` |
| `True` | `list[str]` | `None` |

> Ctrl-C raises `KeyboardInterrupt`.

### Feeding Large / Lazy Data

`iterfzf` accepts any iterable — items are streamed lazily:

```python
import subprocess

# Stream git log lazily
def git_commits():
    proc = subprocess.Popen(["git", "log", "--oneline", "-100"], stdout=subprocess.PIPE, text=True)
    yield from (line.strip() for line in proc.stdout)

commit = iterfzf(git_commits(), prompt="Pick commit > ")
```

---

## Complete Example: Full-Featured Script

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "httpx>=0.27",
#   "rich>=13",
#   "alive-progress>=3",
# ]
# ///

"""Fetch and display GitHub repository statistics."""

import argparse
from pathlib import Path

import httpx
from alive_progress import alive_bar
from rich.console import Console
from rich.table import Table

console = Console()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repos", nargs="+", help="GitHub repos (owner/name)")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Save results to JSON file")
    parser.add_argument("--token", default=None, help="GitHub API token")
    args = parser.parse_args()

    results = []
    with alive_bar(len(args.repos), title="Fetching repos", unit="repos") as bar:
        for repo in args.repos:
            bar.text = f"-> {repo}"
            resp = httpx.get(
                f"https://api.github.com/repos/{repo}",
                headers={"Authorization": f"Bearer {args.token}"} if args.token else {},
            )
            resp.raise_for_status()
            results.append(resp.json())
            bar()

    table = Table(title="Repository Stats")
    table.add_column("Repository", style="cyan")
    table.add_column("Stars", justify="right", style="yellow")
    table.add_column("Forks", justify="right")
    table.add_column("Language", style="green")

    for r in results:
        table.add_row(r["full_name"], str(r["stargazers_count"]), str(r["forks_count"]), r.get("language", "—"))

    console.print(table)

    if args.output:
        import json

        args.output.write_text(json.dumps(results, indent=2))
        console.print(f"[dim]Saved to {args.output}[/dim]")


if __name__ == "__main__":
    main()
```
