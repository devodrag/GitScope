#!/usr/bin/env python3
"""Measure an existing GitScope process tree on Linux."""
import argparse
import json
import os
from pathlib import Path
import time


def stat(pid):
    data = (Path("/proc") / str(pid) / "stat").read_text()
    fields = data.rsplit(")", 1)[1].split()
    return int(fields[1]), int(fields[11]) + int(fields[12])


def family(root):
    processes = {}
    for directory in Path("/proc").iterdir():
        if directory.name.isdecimal():
            try:
                processes[int(directory.name)] = stat(directory.name)
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue
    members = {root}
    while True:
        expanded = members | {pid for pid, (parent, _) in processes.items() if parent in members}
        if expanded == members:
            return {pid: processes[pid][1] for pid in members if pid in processes}
        members = expanded


def sample(pid):
    rollup = Path("/proc") / str(pid) / "smaps_rollup"
    return {
        key: int(value.split()[0])
        for line in rollup.read_text().splitlines()
        if ":" in line
        for key, value in [line.split(":", 1)]
        if key in {"Pss", "Rss"}
    }


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("pid", type=int)
parser.add_argument("--seconds", type=float, default=5)
args = parser.parse_args()
initial = family(args.pid)
if args.pid not in initial or args.seconds <= 0:
    parser.error("Provide a live process ID and positive sample duration")
start = time.monotonic()
time.sleep(args.seconds)
final = family(args.pid)
elapsed = time.monotonic() - start
memory = [sample(pid) for pid in final]
ticks = sum(max(0, end - initial.get(pid, end)) for pid, end in final.items())
print(json.dumps({
    "seconds": round(elapsed, 2),
    "processes": len(final),
    "pssMiB": round(sum(row.get("Pss", 0) for row in memory) / 1024, 1),
    "rssMiB": round(sum(row.get("Rss", 0) for row in memory) / 1024, 1),
    "cpuPercentOneCore": round(100 * ticks / os.sysconf("SC_CLK_TCK") / elapsed, 2),
}))
