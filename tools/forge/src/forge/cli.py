"""Forge command line: ``uv run --project tools/forge forge <command>``."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(
    help="Forge: turn your own DRM-free songs into STEMDECK card packs (local only).",
    no_args_is_help=True,
    add_completion=False,
)
models_app = typer.Typer(help="Separation / beat model weights in ~/.stemdeck/models.", no_args_is_help=True)
app.add_typer(models_app, name="models")
console = Console()
if not console.is_terminal:  # piped / captured output: do not wrap tables at 80 columns
    console = Console(width=180)

STATUS_STYLE = {
    "ok": "[green]OK[/]",
    "warn": "[yellow]WARN[/]",
    "fail": "[bold red]FAIL[/]",
    "info": "[dim]--[/]",
}


@app.command()
def doctor(
    json_out: Annotated[bool, typer.Option("--json", help="Emit the report as JSON.")] = False,
) -> None:
    """Check Python, ffmpeg, GPU/CUDA, disk, Python deps and model weights.

    Exits non-zero only when a required check fails."""
    from . import doctor as doc

    checks = doc.run_checks()
    rep = doc.report(checks)
    if json_out:
        sys.stdout.write(json.dumps(rep, indent=2) + "\n")
    else:
        table = Table(title=f"forge doctor (Forge {rep['forgeVersion']})", show_lines=False)
        for col in ("Group", "Check", "Status", "Required", "Detail", "Fix"):
            table.add_column(col, overflow="fold")
        for c in checks:
            table.add_row(
                c.group, c.name, STATUS_STYLE[c.status], "yes" if c.required else "", c.detail, c.hint
            )
        console.print(table)
        s = rep["summary"]
        verdict = "[green]ready[/]" if rep["ok"] else "[bold red]not ready: a required check failed[/]"
        console.print(
            f"{s['ok']} ok, {s['warn']} warnings, {s['fail']} failures, {s['info']} info: {verdict}"
        )
    raise typer.Exit(0 if rep["ok"] else 1)


@app.command()
def fixtures(
    out: Annotated[Path, typer.Option("--out", help="Output folder (e.g. .fixtures, gitignored).")],
    flac: Annotated[bool, typer.Option("--flac", help="Also write FLAC copies via ffmpeg.")] = False,
    only: Annotated[
        list[str] | None, typer.Option("--only", help="Generate only this song id (repeatable).")
    ] = None,
    list_songs: Annotated[bool, typer.Option("--list", help="List fixture songs and exit.")] = False,
) -> None:
    """Generate synthetic test songs with ground-truth stems and ground_truth.json."""
    from . import fixtures as fx

    if list_songs:
        for s in fx.SONGS:
            console.print(
                f"{s.song_id:20s} {s.bpm:5.0f} BPM {s.beats_per_bar}/4 {fx.key_name(s.tonic, s.mode):9s} "
                f"PCS {s.pcs:2d} {s.bars} bars [{s.purpose}]"
            )
        raise typer.Exit(0)
    try:
        truth = fx.generate(out, only, flac=flac)
    except KeyError as exc:
        console.print(f"[red]{exc.args[0]}[/]")
        raise typer.Exit(2) from exc
    console.print(f"wrote {len(truth['songs'])} songs + ground_truth.json to {out}")


@app.command()
def analyze(
    path: Annotated[
        Path, typer.Argument(help="Audio file, song folder (mix.wav + stems), fixtures root, or folder.")
    ],
    json_out: Annotated[bool, typer.Option("--json", help="Emit full results as JSON.")] = False,
    beats: Annotated[str, typer.Option(help="auto | beat_this | madmom | librosa")] = "auto",
    key: Annotated[str, typer.Option(help="auto | essentia | librosa")] = "auto",
    chroma: Annotated[bool, typer.Option(help="Include per-bar chroma in --json output.")] = True,
) -> None:
    """Beats, downbeats, BPM, 4/4 check, key and per-bar chroma.

    Scores the results against ground_truth.json when the path holds one."""
    from . import analysis as an

    songs, truth = an.resolve_inputs(path)
    gt = {s["songId"]: s for s in truth["songs"]} if truth else {}
    results, scores = [], []
    for s in songs:
        r = an.analyze_song(s, beats, key)
        results.append(r)
        if s.song_id in gt:
            scores.append(an.evaluate(r, gt[s.song_id]))
        if not json_out:
            console.print(f"analyzed {s.song_id} in {r.timings_s['total']:.1f} s", style="dim")
    if json_out:
        out = []
        for r in results:
            d = r.to_dict()
            if not chroma:
                d.pop("chroma")
            out.append(d)
        sys.stdout.write(json.dumps({"results": out, "evaluation": scores or None}, indent=2) + "\n")
        return
    table = Table(title="forge analyze")
    for col in ("Song", "BPM", "Bars", "4/4", "Key (PCS)", "Conf", "Drift %", "Backends", "Time (s)"):
        table.add_column(col, overflow="fold")
    for r in results:
        four = "yes" if r.four_four else f"[red]no[/]: {r.rejection}"
        table.add_row(
            r.song_id,
            f"{r.bpm:.2f}",
            str(r.bar_count),
            four,
            f"{r.key['name']} ({r.key['pcs']})",
            f"{r.key['confidence']:.2f}",
            f"{r.tempo_drift_pct:.2f}",
            f"beats={r.backends['beats']} key={r.backends['key']}",
            f"{r.timings_s['total']:.1f}",
        )
    console.print(table)
    for r in results:
        failed = [a for a in r.attempts["beats"] + r.attempts["key"] if not a["ok"]]
        for a in failed:
            console.print(f"[yellow]{r.song_id}: backend {a['backend']} skipped:[/] {a['error']}")
    if scores:
        t = Table(title="accuracy vs ground_truth.json")
        for col in (
            "Song",
            "BPM err",
            "Beat F",
            "Downbeat F",
            "Meter ok",
            "PCS ok",
            "Key exact",
            "Chroma bass root",
            "Chroma other triad",
        ):
            t.add_column(col)
        for e in scores:
            ch = e["chroma"]
            t.add_row(
                e["songId"],
                f"{e['bpmError']:+.3f}",
                f"{e['beatF']:.3f}",
                f"{e['downbeatF']:.3f}",
                str(e["meterCorrect"]),
                str(e["pcsCorrect"]),
                str(e["keyExact"]),
                f"{ch['bass']['top1IsRoot']:.2f}" if "bass" in ch else "-",
                f"{ch['other']['top3IsTriad']:.2f}" if "other" in ch else "-",
            )
        console.print(t)


@models_app.command("list")
def models_list() -> None:
    """Show each model, its size, license and whether it is downloaded."""
    from .models import MODELS, describe

    table = Table(title="model weights")
    for col in ("Id", "Used for", "File", "Size (MB)", "Status", "License"):
        table.add_column(col, overflow="fold")
    for m in MODELS:
        table.add_row(
            m.id, m.purpose, m.filename, f"{m.size_mb:.0f}" if m.size_mb else "?", describe(m), m.license
        )
    console.print(table)


@models_app.command("download")
def models_download(
    model_ids: Annotated[list[str] | None, typer.Argument(help="Model ids (default: all).")] = None,
) -> None:
    """Download model weights into ~/.stemdeck/models (needs the separation extra and network)."""
    from .models import MODELS, MODELS_BY_ID, download

    ids = model_ids or [m.id for m in MODELS]
    failed = False
    for mid in ids:
        if mid not in MODELS_BY_ID:
            console.print(f"[red]unknown model {mid}[/]; choose from {', '.join(MODELS_BY_ID)}")
            failed = True
            continue
        try:
            files = download(mid)
            console.print(f"[green]{mid}[/]: " + ", ".join(str(f) for f in files))
        except Exception as exc:
            failed = True
            console.print(f"[red]{mid} failed:[/] {type(exc).__name__}: {exc}")
    raise typer.Exit(1 if failed else 0)


@app.command(
    "bench-separation",
    context_settings={"allow_extra_args": True, "ignore_unknown_options": True, "help_option_names": []},
    add_help_option=False,
)
def bench_separation(ctx: typer.Context) -> None:
    """Benchmark separator configs A/B on 3 real songs and/or fixtures (run on the GPU laptop).

    Arguments are passed to the benchmark parser: see `forge bench-separation --help`."""
    from .bench import main

    raise typer.Exit(main(list(ctx.args)))


if __name__ == "__main__":
    app()
