# Nuvio addon: "My YouTube subscriptions"

Shows the latest videos of my YouTube channels in Nuvio (Stremio-compatible): no recommendations, no server to host, subscription list kept private.

## How it works

```
GitHub Action (every 30 min)               Cloudflare Worker (free)               Nuvio
  reads the channels' RSS feeds     ──►   reads the KV and serves the addon  ◄──   /<TOKEN>/manifest.json
  filters out Shorts                      (catalog, meta, stream with ytId)
  writes the result to the KV
```

- `worker/src/index.js`: the Worker. Read-only on the KV, returns 404 if the token in the URL is wrong.
- `worker/src/parse.js`: YouTube RSS feed parsing.
- `worker/scripts/refresh.mjs`: script run by the Action (RSS feeds, Shorts detection, KV writes).
- `.github/workflows/refresh.yml`: Action schedule.
- `worker/test/`: parsing test (`node worker/test/parse.test.mjs`).

Two catalogs:
- **Latest videos** (type `movie`): the 200 latest videos across all channels.
- **Channels** (type `series`): one "series" per channel, sorted by latest upload. The "episodes" are the channel's videos: a single season, episode 1 is the most recent video (the real publish date stays in `released`).

IDs: `yt_<videoId>` for a video, `ytch_<channelId>` for a channel. Returned streams: `ytId` (plays in Nuvio) and `externalUrl` (YouTube / NewPipe).

Each channel keeps its 15 latest videos (what the RSS feed provides), Shorts included before filtering.

KV keys: `videos`, `channels`, `resolved`, `config`, `ch:<id>`. The Action only writes the keys that changed (free tier limit: 1,000 writes/day).

## Privacy

The repo is public, so nothing personal may appear in it:

| Data | Where it lives |
|---|---|
| Channel list | KV key `config` (or `CHANNELS` GitHub secret) |
| KV access (`CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`, `CF_API_TOKEN`) | GitHub Actions secrets |
| Addon URL token (`TOKEN`) | Cloudflare Worker secret |
| Fetched videos | Cloudflare KV (private) |

Action logs are public: the script only prints totals and masks channel IDs, handles and links. Never add a `console.log` of an ID, handle or title.

## Setup

### 1. Cloudflare
1. Create an account at dash.cloudflare.com (Free plan).
2. Workers & Pages → Create → Import a repository → this repo.
3. Project name `yt-subs-addon`, branch `main`, Root directory `worker`, then Save and Deploy.
4. Worker → Settings → Variables and Secrets → add a **Secret** `TOKEN` (24 random letters/digits, keep a copy). This is the runtime section, not "Build variables".
5. In Settings → Bindings, check that `KV` is bound to a namespace (otherwise create one under Storage & Databases → KV and add it as binding `KV`).

### 2. GitHub
Settings → Secrets and variables → Actions → New repository secret:

| Name | Value |
|---|---|
| `CF_ACCOUNT_ID` | Workers & Pages, right-hand column |
| `CF_KV_NAMESPACE_ID` | Storage & Databases → KV → namespace ID |
| `CF_API_TOKEN` | My Profile → API Tokens → Custom Token, permission *Account → Workers KV Storage → Edit* |
| `CHANNELS` (optional if the KV key `config` exists) | channel list, see below |

### 3. Channel list
Create the KV key `config` in the Cloudflare dashboard (Storage & Databases → KV → your namespace → KV Pairs → Add entry). One channel per line (commas and spaces also work). Accepted forms:
- `@handle`
- a channel link (`https://www.youtube.com/@name`, `/channel/UC...`)
- a channel ID `UC...`

The `subscriptions.csv` from Google Takeout (YouTube → subscriptions) can be pasted as is: the header is ignored and only the first column (ID) is read. `@handles` can be appended after it.

Handles and links are converted to IDs by the Action; the result is cached in the KV (`resolved`). `config` takes priority over the `CHANNELS` secret. GitHub secrets are write-only, which is why the KV key is easier to edit.

### 4. First run
Actions tab → *Refresh YouTube feeds* → Run workflow. The log should show `N entries: N channels, 0 unresolved`, then `N channels: N ok, 0 failed`, then `N videos, N channels, N writes, 0 deletions`. The first run is longer because every video is checked for Shorts.

### 5. Nuvio
Install `https://yt-subs-addon.<account>.workers.dev/<TOKEN>/manifest.json`.

## Managing channels

Edit the `config` KV key, then re-run the workflow or wait for the next scheduled run. A removed channel disappears from the catalog on the next run.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing secret: XXX` | secret missing or misnamed |
| `HTTP 401/403` on the KV | wrong Cloudflare token, or missing *Workers KV Storage: Edit* permission |
| `N unresolved` | handle or link not found (typo) or YouTube page blocked from GitHub: use the `UC...` ID instead |
| `0 ok` | YouTube refuses requests from GitHub |
| "Not found" in the browser | URL token differs from the `TOKEN` secret, or the secret was set in "Build variables" instead of the runtime section |
| Shorts show up | YouTube blocks the `/shorts/<id>` probe from GitHub |
| No more updates | GitHub disables scheduled workflows after 60 days without repo activity: re-enable them in the Actions tab |

The schedule is the `cron:` line in `.github/workflows/refresh.yml` (GitHub accepts 5 minutes at the minimum and often delays runs by a few minutes).
