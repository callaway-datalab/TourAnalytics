"""A synthetic PGA Tour API for tests. The response shapes are the ones pga.py parses; the numbers are made up but obey the real identities
(total = parts, left + right = missed fairways, ...). It is NOT a recording of the real API: record real rounds with PGA_RECORD_DIR for that."""
import random

SG_IDS = {"02675": "total", "02567": "ott", "02568": "app", "02569": "arg", "02564": "putt", "02674": "t2g"}


TITLES = {"102": {"statTitle2": "Fairways Hit", "statTitle3": "Possible Fairways"},
          "02422": {"statTitle2": "Fairways Missed"}, "02423": {"statTitle2": "Fairways Missed"}}


class FakeAPI:
    def __init__(self, n_players=14, rounds=2, seed=7, tnum="554", year=2026):
        rnd = random.Random(seed)
        self.rounds, self.tnum, self.year = rounds, tnum, year
        self.players = [{"p_id": str(1000 + i), "first_name": f"Player{i}", "last_name": f"Last{i}", "country": "USA"} for i in range(n_players)]
        self.data = {}                       # (round, pid) -> dict of generated values
        for r in range(1, rounds + 1):
            for i, p in enumerate(self.players):
                ott, app, arg, putt = (round(rnd.uniform(-2, 2), 3) for _ in range(4))
                hit = 14 if i == 0 else rnd.randint(5, 13)        # player 0 hits every fairway: no left, no right
                missed = 14 - hit
                left = 0 if i == 1 else (missed if i == 2 else rnd.randint(0, missed))
                self.data[(r, p["p_id"])] = dict(ott=ott, app=app, arg=arg, putt=putt, t2g=round(ott + app + arg, 3),
                                                 total=round(ott + app + arg + putt, 3), hit=hit, missed=missed, left=left,
                                                 right=missed - left, birdies=rnd.randint(0, 6))

    def stat_values(self, sid, r, pid):
        d = self.data[(r, pid)]
        if sid in SG_IDS:
            return {"statValue1": str(d[SG_IDS[sid]])}, {}
        if sid == "102":
            return ({"statValue1": f'{100.0 * d["hit"] / 14:.2f}', "statValue2": str(d["hit"]), "statValue3": "14"},
                    {"statTitle2": "Fairways Hit", "statTitle3": "Possible Fairways"})
        if sid in ("02422", "02423"):
            n, k = d["missed"], d["left"] if sid == "02422" else d["right"]
            if n == 0 or k == 0:                                   # the API leaves the player out when the count is 0
                return None, {}
            return {"statValue1": f"{100.0 * k / n:.2f}", "statValue2": str(k)}, {"statTitle2": "Fairways Missed"}
        if sid == "107":
            return {"statValue1": str(d["birdies"])}, {}
        return None, {}

    def __call__(self, path, **p):
        if path.startswith("/SyndPlayersMaster"):
            return self.players
        if path.startswith("/SyndPlayerRoundStats"):
            sid, r = p["STAT_ID"], int(p["R_ID"])
            if r > self.rounds:
                return {"tours": []}
            details = []
            for pl in self.players:
                sv, titles = self.stat_values(sid, r, pl["p_id"])
                if sv is None:
                    continue
                details.append({"plrNum": pl["p_id"], "curRank": "1", "plrName": [{"first": pl["first_name"], "last": pl["last_name"]}],
                                "statValues": [sv]})
            titles = TITLES.get(sid, {})
            return {"tours": [{"years": [{"stats": [{"statName": f"Stat {sid}", "explanation": "", "statTitles": [titles],
                                                     "rounds": [{"round_number": r, "details": details}]}]}]}]}
        raise LookupError(path)


EXTRAS = [
    {"id": "102", "label": "Driving Accuracy", "counts": True, "pct": True},
    {"id": "02422", "label": "Left Tendency", "counts": True, "pct": True, "missing_means_zero": True, "complement": "02423", "group": "Driving - More"},
    {"id": "02423", "label": "Right Tendency", "counts": True, "pct": True, "missing_means_zero": True, "complement": "02422", "group": "Driving - More"},
    {"id": "107", "label": "Birdies", "agg": "sum"},
]


class FakeSchedule(FakeAPI):
    """Adds a schedule so build_data.main() can run end to end."""
    def __call__(self, path, **p):
        if path.startswith("/SyndSchedule"):
            return [{"T_ID": f"{p['T_CODE']}{p['YEAR']}554", "Tournament_Name": "Test Open", "start_date": "2026-10-08", "end_date": "2026-10-11"}]
        return super().__call__(path, **p)
