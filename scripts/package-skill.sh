#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <skill-name> [output-directory]" >&2
  exit 2
fi

skill_name="$1"

if [[ ! "$skill_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Invalid skill name: $skill_name" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
skill_dir="$repo_root/skills/$skill_name"
output_dir="${2:-$repo_root/dist/skills}"

if [[ ! -f "$skill_dir/SKILL.md" ]]; then
  echo "Missing skill entry point: $skill_dir/SKILL.md" >&2
  exit 1
fi

if find "$skill_dir" -name '.DS_Store' -o -name '__MACOSX' | grep -q .; then
  echo "Refusing to package macOS metadata from $skill_dir" >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "The 'zip' command is required." >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "The 'shasum' command is required." >&2
  exit 1
fi

mkdir -p "$output_dir"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/package-skill.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT

archive_name="$skill_name.zip"
temp_archive="$temp_dir/$archive_name"

(
  cd "$repo_root/skills"
  zip -X -q -r "$temp_archive" "$skill_name"
)

unzip -tq "$temp_archive" >/dev/null
mv "$temp_archive" "$output_dir/$archive_name"
(
  cd "$output_dir"
  shasum -a 256 "$archive_name" > "$archive_name.sha256"
)

echo "Created $output_dir/$archive_name"
echo "Created $output_dir/$archive_name.sha256"
