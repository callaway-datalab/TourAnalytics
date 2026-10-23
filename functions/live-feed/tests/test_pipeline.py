import copy
import json
import pytest
import httpx

import checks
import fakeapi
import pga


@pytest.fixture()
def api(monkeypatch, tmp_path):
    api = fakeapi.FakeAPI()
    monkeypatch.setattr(pga, "_get_unlimited", api)
    monkeypatch.setattr(pga, "_get", lambda path, **p: api(path, **p))
    pga._cache.clear()
    return api


def bundle_for(api):
    return pga.build_event_bundle(api.tnum, api.year, "R", prefer="synd", extras=fakeapi.EXTRAS)


def test_clean_bundle_passes_every_check(api):
    b = bundle_for(api)
    assert not b["error"] and not b["partial"] and len(b["rounds"]) == 2
    res = checks.validate(b, fakeapi.EXTRAS)
    assert res["blocking"] == []
    for name in ("sg_total", "sg_t2g", "pct_matches_counts", "complement_sums", "event_counts", "event_sums"):
        assert res["summary"][name][0] > 0, name
        assert res["summary"][name][1] == 0, (name, res)


def test_left_right_filled_for_missing_rows(api):
    b = bundle_for(api)
    r1 = {row["player_id"]: row["x"] for row in b["rounds"]["1"]["rows"]}
    p0, p1, p2 = "1000", "1001", "1002"
    assert (r1[p0]["02422"]["k"], r1[p0]["02422"]["n"]) == (0, 0)               # no missed fairways at all
    d1, d2 = api.data[(1, p1)], api.data[(1, p2)]
    assert (r1[p1]["02422"]["k"], r1[p1]["02422"]["n"]) == (0, d1["missed"])    # left missing from the API = 0 left
    assert (r1[p2]["02423"]["k"], r1[p2]["02423"]["n"]) == (0, d2["missed"])    # right missing = 0 right


def test_event_counts_equal_sum_of_rounds(api):
    b = bundle_for(api)
    for row in b["event"]["rows"]:
        e = row["x"].get("02422")
        if not e:
            continue
        K = sum(api.data[(r, row["player_id"])]["left"] for r in (1, 2))
        N = sum(api.data[(r, row["player_id"])]["missed"] for r in (1, 2))
        assert e["d"].endswith(f"({K}/{N})"), (row["player_id"], e)


def test_corrupt_strokes_gained_blocks(api):
    b = bundle_for(api)
    for row in b["rounds"]["1"]["rows"][:6]:
        row["putting"]["round"] += 1.0
    res = checks.validate(b, fakeapi.EXTRAS)
    assert any(x.startswith("sg_total") for x in res["blocking"])


def test_round_in_progress_skips_strokes_gained_parts(api):
    b = bundle_for(api)
    for row in b["rounds"]["1"]["rows"][:6]:
        row["tee_to_green"]["round"] += 0.6          # live feed mid-round: T2G and total on a different basis than the parts
        row["total"]["round"] += 0.6
    b["rounds"]["1"]["rows"][0]["thru"] = 4
    res = checks.validate(b, fakeapi.EXTRAS)
    assert res["blocking"] == [] and any("R1 is in progress" in x for x in res["info"])
    del b["rounds"]["1"]["rows"][0]["thru"]          # once the round is final the same numbers block
    assert any(x.startswith("sg_total") for x in checks.validate(b, fakeapi.EXTRAS)["blocking"])


def test_live_round_not_started_has_no_data(monkeypatch):
    def live(t_code, year, t_num, rnd):
        val = "0.786" if rnd == 1 else ""             # later rounds: a placeholder row per player, no values
        return {"trn": [{"T_ID": "R2026528", "rnd": rnd, "plrStats": [
            {"id": pga.SG_STATS["total"], "p": [{"id": "1000", "rV1": val, "rR": ""}]}]}]}
    monkeypatch.setattr(pga, "_live", live)
    assert pga._live_round("528", 2026, 1, "R")[0] is not None
    trn, by_stat, err = pga._live_round("528", 2026, 4, "R")
    assert trn is None and err == "the API returned no strokes gained rows"


def test_broken_complement_blocks(api):
    b = bundle_for(api)
    for row in b["rounds"]["1"]["rows"]:
        e = row["x"].get("02422")
        if e and e.get("n"):
            e["k"] = e["n"] + 2
    res = checks.validate(b, fakeapi.EXTRAS)
    assert res["blocking"]


def test_one_odd_value_does_not_block(api):
    b = bundle_for(api)
    b["rounds"]["1"]["rows"][0]["putting"]["round"] += 1.0
    assert checks.validate(b, fakeapi.EXTRAS)["blocking"] == []


def test_ratio_above_one_does_not_block():
    extras = [{"id": "104", "label": "Putts per GIR", "counts": True, "ratio": True},
              {"id": "02420", "label": "Fairways", "counts": True, "pct": True}]
    def bundle(sid, k, n, v):
        rows = [{"player_id": str(i), "name": f"P{i}", "x": {sid: {"k": k, "n": n, "v": v, "d": f"{v} ({k}/{n})"}}} for i in range(10)]
        return {"rounds": {"1": {"rows": rows}}, "event": None}
    assert checks.validate(bundle("104", 24, 16, 1.5), extras)["blocking"] == []           # 24 putts on 16 greens is fine
    assert checks.validate(bundle("02420", 16, 14, 114.29), extras)["blocking"]             # 16 of 14 fairways is not


def test_thru_marks_rounds_in_progress(api):
    b = bundle_for(api)
    holes = {"106": 0, "107": 2, "523": 6, "184": 1, "520": 0, "521": 0}      # 9 holes
    full = {"106": 0, "107": 4, "523": 12, "184": 2, "520": 0, "521": 0}      # 18 holes
    b["latest_round"] = 2
    rows = b["rounds"]["2"]["rows"]
    for sid, v in holes.items():
        rows[0].setdefault("x", {})[sid] = {"v": v, "d": str(v)}
    for sid, v in full.items():
        rows[1].setdefault("x", {})[sid] = {"v": v, "d": str(v)}
    checks.annotate_thru(b)
    assert rows[0]["thru"] == 9 and "thru" not in rows[1]
    ev = {r["player_id"]: r for r in b["event"]["rows"]}
    assert ev[rows[0]["player_id"]]["thru"] == 9 and ev[rows[0]["player_id"]]["thru_round"] == 2


def test_record_then_replay_gives_identical_bundle(api, monkeypatch, tmp_path):
    monkeypatch.undo()                                    # use the real _get wrapper, with the fake underneath
    monkeypatch.setattr(pga, "_get_unlimited", api)
    pga._cache.clear()
    monkeypatch.setenv("PGA_RECORD_DIR", str(tmp_path))
    first = bundle_for(api)
    assert list(tmp_path.glob("*.json"))
    monkeypatch.delenv("PGA_RECORD_DIR")
    monkeypatch.setenv("PGA_REPLAY_DIR", str(tmp_path))
    monkeypatch.setattr(pga, "_get_unlimited", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network used during replay")))
    pga._cache.clear()
    second = bundle_for(api)
    strip = lambda b: {k: v for k, v in b.items() if k != "fetched_at"}
    assert strip(first) == strip(second)


def test_reason_for():
    import build_data as bd
    from datetime import date
    ev = {"start": "2026-10-08"}
    assert bd.reason_for(ev, {"rounds": {"1": {}}}, date(2026, 10, 10)) is None
    assert bd.reason_for(ev, None, date(2026, 10, 10)) == "fetch_failed"
    assert bd.reason_for(ev, {"rounds": {}, "partial": True}, date(2026, 10, 10)) == "fetch_failed"
    assert bd.reason_for(ev, {"rounds": {}, "partial": False}, date(2026, 10, 8)) == "not_yet"
    assert bd.reason_for(ev, {"rounds": {}, "partial": False}, date(2026, 10, 10)) == "no_shotlink"


def test_build_data_end_to_end(monkeypatch, tmp_path):
    import build_data as bd
    api = fakeapi.FakeSchedule()
    monkeypatch.setattr(pga, "_get_unlimited", api)
    monkeypatch.setattr(pga, "_get", lambda path, **p: api(path, **p))
    monkeypatch.setenv("PGA_TODAY", "2026-10-10")
    pga._cache.clear()
    monkeypatch.setattr(bd, "OUT", tmp_path)
    monkeypatch.setattr(bd, "TOURS", ["R"])
    monkeypatch.setattr(bd, "STATS", fakeapi.EXTRAS)
    bd.main()
    cur = json.loads((tmp_path / "current.json").read_text())
    ent = cur["tours"][0]
    assert ent["has_data"] and ent["reason"] is None and ent["status"] == "live"
    bundle = json.loads((tmp_path / ent["path"].removeprefix("data/")).read_text())
    assert bundle["checks"]["sg_total"][1] == 0
    first = (tmp_path / "current.json").read_text()
    bd.main()                                                    # nothing changed: current.json must not be rewritten
    assert (tmp_path / "current.json").read_text() == first
    assert not list(tmp_path.rglob("*.tmp"))


def test_failed_validation_keeps_previous_file(monkeypatch, tmp_path):
    import build_data as bd
    api = fakeapi.FakeSchedule()
    monkeypatch.setattr(pga, "_get_unlimited", api)
    monkeypatch.setattr(pga, "_get", lambda path, **p: api(path, **p))
    monkeypatch.setenv("PGA_TODAY", "2026-10-10")
    pga._cache.clear()
    monkeypatch.setattr(bd, "OUT", tmp_path)
    monkeypatch.setattr(bd, "TOURS", ["R"])
    monkeypatch.setattr(bd, "STATS", fakeapi.EXTRAS)
    bd.main()
    path = next(tmp_path.rglob("2026-554.json"))
    good = path.read_text()
    for k in api.data:                                            # the API now returns a total that is not the sum of its parts
        api.data[k]["total"] += 1.0
    pga._cache.clear()
    bd.main()
    assert path.read_text() == good
    assert bd.BLOCKED


def test_event_value_when_one_round_has_no_rows_for_a_stat(api, monkeypatch):
    extras = fakeapi.EXTRAS + [{"id": "338", "label": "Proximity 150-175 yds", "counts": True, "lower": True}]
    orig = api.stat_values
    def sv(sid, r, pid):
        if sid == "338":
            return ({"statValue1": "30' 6\"", "statValue2": "3"}, {}) if r == 1 else (None, {})   # nothing at all in round 2
        return orig(sid, r, pid)
    monkeypatch.setattr(api, "stat_values", sv)
    monkeypatch.setitem(fakeapi.TITLES, "338", {"statTitle2": "Shots"})
    b = pga.build_event_bundle(api.tnum, api.year, "R", prefer="synd", extras=extras)
    e = b["event"]["rows"][0]["x"]["338"]
    assert e["part"] == [1] and e["v"] == 366.0
