"""Toad's Factory players who played in a league (their profile's played_in_league), with their
Mii picture: league_players.json. Profiles are kept in cache/players."""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'http://toadsfactory.mkw.gg'
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache', 'players')


def profile(pid):
    path = os.path.join(CACHE, f'{pid}.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(f'{BASE}/api/player/{pid}', timeout=30).read()
            break
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        return None
    os.makedirs(CACHE, exist_ok=True)
    open(path, 'wb').write(data)
    time.sleep(0.25)
    return json.loads(data)


def main():
    players = json.loads(urllib.request.urlopen(f'{BASE}/api/player', timeout=60).read())['players']
    with ThreadPoolExecutor(3) as ex:
        profiles = list(ex.map(lambda p: profile(p['player_id']), players))
    out = [{'id': p['player_id'], 'name': p['name'], 'mii': p['mii']} for p, prof in zip(players, profiles)
           if prof and prof.get('played_in_league') and p.get('mii') and p['mii'] != 'default.png']
    json.dump(out, open('league_players.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(len(players), 'players,', len(out), 'played in a league with a Mii')


if __name__ == '__main__':
    main()
