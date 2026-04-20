#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "ruamel.yaml>=0.19.0,<0.20.0",
# ]
# ///

import json
import hashlib
from pathlib import Path
from ruamel.yaml import YAML

# Strict RFC v0.2.0 Configuration
SKILLS_DIR = Path("skills")
OUTPUT_DIR = Path(".well-known/agent-skills")
OUTPUT_FILE = OUTPUT_DIR / "index.json"

yaml = YAML(typ="safe")


def get_sha256(filepath):
    """Calculates the SHA-256 checksum of a file."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def parse_frontmatter(content):
    """Extracts and parses YAML frontmatter using ruamel.yaml."""
    lines = content.splitlines()

    # Check if the file actually starts with a frontmatter delimiter
    if not lines or lines[0].strip() != "---":
        return {}

    yaml_lines = []
    for line in lines[1:]:
        if line.strip() == "---":
            break
        yaml_lines.append(line)

    yaml_text = "\n".join(yaml_lines)
    if not yaml_text.strip():
        return {}

    try:
        parsed_data = yaml.load(yaml_text)
        return parsed_data if isinstance(parsed_data, dict) else {}
    except Exception as e:
        print(f"Warning: Could not parse YAML frontmatter: {e}")
        return {}


def build_index():
    skills = []

    # Strictly crawl for SKILL.md
    for path in SKILLS_DIR.rglob("SKILL.md"):
        content = path.read_text(encoding="utf-8")
        meta = parse_frontmatter(content)

        # Fallback to the parent directory name if 'name' isn't in the frontmatter
        name = meta.get("name", path.parent.name)
        description = meta.get("description", "")

        # RFC v0.2.0 single-artifact model format
        skills.append(
            {
                "name": name,
                "type": "skill-md",
                "description": description,
                "url": f"/{path.as_posix()}",
                "digest": f"sha256:{get_sha256(path)}",
            }
        )

    return skills


if __name__ == "__main__":
    if not SKILLS_DIR.exists():
        print(f"Error: Directory '{SKILLS_DIR}' not found.")
        exit(1)

    # Ensure the .well-known/agent-skills directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index_data = {
        "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        "skills": build_index(),
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=2)

    print(
        f"✅ Successfully built RFC v0.2.0 compliant index for {len(index_data['skills'])} skills at {OUTPUT_FILE}"
    )

