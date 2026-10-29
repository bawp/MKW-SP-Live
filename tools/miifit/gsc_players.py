"""The Toad's Factory players whose Miis the game can show: the Grand Star Cup's Division 1 players
(gsc_players.json, for fit_all.py). Seasons 1-14: the members of each Division 1 team on Toad's
Factory. Seasons 15 on: mkw-stats' Division 1 rosters, Season 16's MK Central registrations and the
projected lineups, matched to Toad's Factory as the runtime does (its id tables, then the name, the
friend codes to tell players of one name apart). Where the runtime might pick either of a name's
players, both are kept."""
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, '..', '..', 'sandbox-rankings', 'BuildWorkspace', 'runtime', 'src', 'mkwlb_rankings.cpp')
TOADS = 'http://toadsfactory.mkw.gg'
STATS = 'https://mkw-stats.web.app'
MKC = 'https://mkcentral.com'


def get(url, cache=None):
    path = os.path.join(HERE, 'cache', 'gsc', cache) if cache else None
    if path and os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (miifit)'})
            data = json.loads(urllib.request.urlopen(req, timeout=60).read())
            break
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(url)
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(data, open(path, 'w', encoding='utf-8'))
    return data


def digits(fc):
    return re.sub(r'\D', '', fc or '')


def runtime_tables():
    src = open(SOURCE, encoding='utf-8').read()

    def block(name):
        i = src.index(name)
        return src[i:src.index('\n};', i)]
    seasons = re.findall(r'\{"(s\d+)", "Season \d+"(?:, (\d+))?(?:, (\d+))?\}', block('constexpr EsSeason kEsSeasons[]'))
    stats_ids = dict((int(a), int(b)) for a, b in re.findall(r'\{(\d+), (\d+)\}', block('kEsToadsPlayers[] = {')))
    bridge = dict((int(a), int(b)) for a, b in re.findall(r'\{(\d+), (\d+)\}', block('kEsPlayerBridge[] = {')))
    links = [(t, n, int(i)) for t, n, i in re.findall(r'\{"([^"]*)", "([^"]*)", (\d+)\}', block('kEsToadsNameLinks[] = {'))]
    projected = re.findall(r'\{"([^"]+)"(?:, (\d+))?\}', block('kEsProjected[] = {'))
    return seasons, stats_ids, bridge, links, projected


def main(only=None):
    seasons, stats_ids, bridge, links, projected = runtime_tables()
    toads = get(TOADS + '/api/player', 'toads_players.json')['players']
    by_id = {p['player_id']: p for p in toads}
    by_name = {}
    for p in toads:
        by_name.setdefault(p['name'].strip().lower(), []).append(p)
    chosen = {}   # toads id -> why

    def take(pid, why):
        if pid in by_id:
            chosen.setdefault(pid, why)

    def profile(pid):
        return get(f'{TOADS}/api/player/{pid}', f'player_{pid}.json')

    def match(name, fcs=(), stats_id=0, tag=''):
        if stats_id in stats_ids:
            return take(stats_ids[stats_id], 'id table')
        if stats_id in bridge:
            return take(bridge[stats_id], 'id table')
        for t, n, i in links:
            if n.lower() == name.lower() and (not tag or t.lower() == tag.lower()):
                return take(i, 'name link')
        cands = []
        for part in [name] + (name.split('/') if '/' in name else []):
            for p in by_name.get(part.strip().lower(), []):
                if p not in cands:
                    cands.append(p)
        if len(cands) == 1:
            return take(cands[0]['player_id'], 'name')
        codes = {digits(f) for f in fcs}
        league = []
        for c in cands:
            prof = profile(c['player_id'])
            if codes & {digits(f['fc']) for f in prof.get('fcs') or []}:
                return take(c['player_id'], 'friend code')
            if prof.get('played_in_league'):
                league.append(c)
        for c in league:
            take(c['player_id'], 'name (one of several)')

    for sid, division, tournament in seasons:
        if only and sid != only:   # one season's players (gsc_players.py s16 -> gsc_players_s16.json)
            continue
        division, tournament = int(division or 0), int(tournament or 0)
        if division:   # Toad's Factory's Division 1
            for row in get(f'{TOADS}/api/division/{division}/standing', f'div_{division}.json')['clanStandings']:
                for mem in row['participant'].get('members') or []:
                    take(mem['player_id'], sid + ' team member')
            continue
        st = get(f'{STATS}/api/standings?league=gsc&season={sid}&division=d1', f'standings_{sid}.json')
        tags = set()
        for team in st['standings']:
            tags.add(team['tag'].lower())
            for role in ('runner', 'bagger'):
                roster = get(f"{STATS}/api/teams/{team['team_id']}/roster?league=gsc&season={sid}&role={role}",
                             f"roster_{sid}_{team['team_id']}_{role}.json")
                for p in roster.get('players') or []:
                    match(p['name'], p.get('friend_codes') or [], p.get('player_id') or 0, team['tag'])
        for p in st.get('leaderboard') or []:
            match(p['name'], (), p.get('player_id') or 0)
        if tournament:
            for squad in get(f'{MKC}/api/tournaments/{tournament}/registrations', f'mkc_{tournament}.json'):
                if squad['tag'].lower() in tags:
                    for p in squad.get('players') or []:
                        match(p['name'], [f['fc'] for f in p.get('friend_codes') or [] if f.get('type') == 'mkw'], 0, squad['tag'])
    for name, tid in projected:
        if tid:
            take(int(tid), 'projected')
        else:
            match(name)

    with_mii = [by_id[i] for i in chosen if by_id[i].get('mii') and by_id[i]['mii'] != 'default.png']
    out = [{'id': p['player_id'], 'name': p['name'], 'mii': p['mii']} for p in with_mii]
    name = f'gsc_players_{only}.json' if only else 'gsc_players.json'
    json.dump(out, open(os.path.join(HERE, name), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(len(chosen), 'Grand Star Cup players on Toad\'s Factory,', len(out), 'with a Mii picture,',
          len({p['mii'] for p in out}), 'pictures')


if __name__ == '__main__':
    main(*sys.argv[1:])
