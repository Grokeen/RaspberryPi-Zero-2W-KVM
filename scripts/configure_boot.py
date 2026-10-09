#!/usr/bin/env python3
"""2026-10-09 22:32 KST: CodexCode - backed-up, repeatable peripheral boot setup."""
from datetime import datetime
from pathlib import Path
import re
import shutil


def configure(root):
    config = root / "config.txt"
    cmdline = root / "cmdline.txt"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    original = config.read_text()
    marker = "# CodexCode Zero 2 W KVM - USB peripheral"
    generated = f"\n\n{marker}\n[all]\ndtoverlay=dwc2,dr_mode=peripheral\n"
    base_config = original.replace(generated, "\n")
    section = "all"
    lines = []
    for line in base_config.splitlines():
        if re.fullmatch(r"\[.+\]", line.strip()):
            section = line.strip()[1:-1]
        if section in ("all", "pi0", "pi02") and re.match(r"\s*dtoverlay=dwc2(?:,|$)", line):
            continue
        lines.append(line)
    # Replacing our generated block keeps repeated installs from accumulating markers.
    lines = [line for line in lines if line != marker]
    updated = "\n".join(lines).rstrip() + generated
    old_cmdline = cmdline.read_text()
    tokens = old_cmdline.split()
    for index, token in enumerate(tokens):
        if token.startswith("modules-load="):
            modules = token.split("=", 1)[1].split(",")
            if any(module.startswith("g_") for module in modules):
                raise RuntimeError("Legacy USB gadget in cmdline.txt; resolve its ownership before installing")
            modules = list(dict.fromkeys([*modules, "dwc2", "libcomposite"]))
            tokens[index] = "modules-load=" + ",".join(modules)
            break
    else:
        tokens.append("modules-load=dwc2,libcomposite")
    new_cmdline = " ".join(tokens) + "\n"
    for path, before, after in [(config, original, updated), (cmdline, old_cmdline, new_cmdline)]:
        if before != after:
            backup = path.with_name(path.name + f".codexcode-{stamp}.bak")
            if not backup.exists():
                shutil.copy2(path, backup)
            path.write_text(after)
            print(f"Updated {path}; backup: {backup}")


if __name__ == "__main__":
    root = Path("/boot/firmware")
    if not (root / "config.txt").exists():
        root = Path("/boot")
    configure(root)
