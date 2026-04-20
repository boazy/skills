#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "pathspec>=1,<2",
#     "ruamel.yaml>=0.19.0,<0.20.0",
# ]
# ///

"""
Builds an RFC v0.2.0 compliant agent-skills discovery site.

Reads skill directories from skills/, determines type (skill-md vs archive),
and writes everything to _site/.well-known/agent-skills/ including:
  - index.json (discovery index)
  - SKILL.md files (for skill-md type skills)
  - .tar.gz archives (for multi-file skills)
  - .nojekyll (disables Jekyll processing on GitHub Pages)
"""

import json
import hashlib
import shutil
import tarfile
from pathlib import Path

import pathspec
from ruamel.yaml import YAML

SKILLS_DIR = Path("skills")
SITE_DIR = Path("_site")
OUTPUT_DIR = SITE_DIR / ".well-known" / "agent-skills"

yaml = YAML(typ="safe")

gitignore_path = Path(".gitignore")
if gitignore_path.exists():
    ignore_spec = pathspec.PathSpec.from_lines(
        "gitwildmatch", gitignore_path.read_text().splitlines()
    )
else:
    ignore_spec = pathspec.PathSpec.from_lines("gitwildmatch", [])


def get_sha256(filepath):
    """Calculates the SHA-256 checksum of a file."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def parse_frontmatter(content):
    """Extracts and parses YAML frontmatter using ruamel.yaml."""
    lines = content.splitlines()

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
        print(f"  Warning: Could not parse YAML frontmatter: {e}")
        return {}


def get_skill_files(skill_dir):
    files = []
    for path in skill_dir.rglob("*"):
        if path.is_file() and not ignore_spec.match_file(path.relative_to(Path("."))):
            files.append(path)
    return sorted(files)


def create_tar_gz(skill_dir, skill_name, files):
    archive_path = OUTPUT_DIR / f"{skill_name}.tar.gz"

    with tarfile.open(archive_path, "w:gz") as tar:
        for file_path in files:
            arcname = str(file_path.relative_to(skill_dir))
            info = tar.gettarinfo(file_path, arcname=arcname)
            # Normalize ownership for reproducibility
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            with open(file_path, "rb") as f:
                tar.addfile(info, f)

    return get_sha256(archive_path)


def build_index():
    skills = []

    for skill_md_path in sorted(SKILLS_DIR.rglob("SKILL.md")):
        skill_dir = skill_md_path.parent
        content = skill_md_path.read_text(encoding="utf-8")
        meta = parse_frontmatter(content)

        name = meta.get("name", skill_dir.name)
        description = meta.get("description", "")
        skill_files = get_skill_files(skill_dir)

        if len(skill_files) == 1:
            out_path = OUTPUT_DIR / name / "SKILL.md"
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(skill_md_path, out_path)

            skills.append({
                "name": name,
                "type": "skill-md",
                "description": description,
                "url": f"/.well-known/agent-skills/{name}/SKILL.md",
                "digest": f"sha256:{get_sha256(out_path)}",
            })
            print(f"  {name} (skill-md)")
        else:
            digest = create_tar_gz(skill_dir, name, skill_files)

            skills.append({
                "name": name,
                "type": "archive",
                "description": description,
                "url": f"/.well-known/agent-skills/{name}.tar.gz",
                "digest": f"sha256:{digest}",
            })
            print(f"  {name} (archive, {len(skill_files)} files)")

    return skills


if __name__ == "__main__":
    if not SKILLS_DIR.exists():
        print(f"Error: Directory '{SKILLS_DIR}' not found.")
        exit(1)

    if SITE_DIR.exists():
        shutil.rmtree(SITE_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Building RFC v0.2.0 skill index...\n")

    index_data = {
        "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        "skills": build_index(),
    }

    index_path = OUTPUT_DIR / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, indent=2)
        f.write("\n")

    # Disable Jekyll processing for GitHub Pages
    (SITE_DIR / ".nojekyll").touch()

    print(f"\nBuilt {len(index_data['skills'])} skills -> {OUTPUT_DIR}")

