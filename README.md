# home-realtime-assistant

Jatkuvasti kuunteleva PWA-pohjainen puheassistentti, joka käyttää OpenAI Realtime API:a WebRTC:llä. Monorepo sisältää kolme pääosaa:

- **apps/web** – iOS Safari/PWA:han sopiva UI.
- **apps/orchestrator** – backend, joka luo Realtime-ephemeraaliavaimet, asettaa policyt ja välittää työkalukutsut.
- **apps/tool-gateway** – rajattu työkalupalvelu allowlist-skeemoilla.
- **packages/shared** – jaetut skeemat, apurit ja loggerit.
- **infra** – docker-compose ja käänteisen proxyn esimerkit.

## Nopea startti docker-composella

1. Kopioi `.env.example` jokaisesta sovelluksesta ja täytä arvot (vähintään `OPENAI_API_KEY`, `AUTH_SHARED_SECRET`, `INTERNAL_HMAC_SECRET`, `ALLOWLIST_HTTP_HOSTS`).
2. Aja:
   ```bash
   docker compose -f infra/docker-compose.yml up --build
   ```
3. Web on osoitteessa `http://localhost:4173`, orchestrator `http://localhost:3001`, tool-gateway `http://localhost:4001` (vain sisäverkossa / HMAC).

Selainpyynnöt `POST /api/realtime/token` vaativat headerin `x-shared-secret` (`AUTH_SHARED_SECRET` arvo).

## Kehityskäynnistys ilman Dockeria

```bash
pnpm install
pnpm --filter @home/tool-gateway dev   # portti 4001
pnpm --filter @home/orchestrator dev   # portti 3001
pnpm --filter @home/web dev            # portti 4173
```

Lisää `.env`-tiedostot `.env.example`-pohjista. Kehityksessäkin vaaditaan `AUTH_SHARED_SECRET` ja `INTERNAL_HMAC_SECRET`.

## iOS PWA -ohje

1. Avaa `http://localhost:4173` Safarilla.
2. Lisää Kotiin “Share” → “Add to Home Screen”.
3. Ensimmäisellä käynnistyksellä paina **Start listening** avatakseen mikrofonin (iOS vaatii käyttäjäeleen).

## Arkkitehtuuri lyhyesti

- Selain hakee ephemeraaliavaimen `POST /api/realtime/token` -endpointista. OpenAI API -avain pysyy backendissä.
- Orchestrator asettaa Realtime-sessin ohjeet (VAD, työkalupolitiikka) ja reitittää työkalupyynnöt tool-gatewayhin HMAC-allekirjoituksella.
- Tool-gateway validoi työkalun nimen ja argsit Zod-skeemoilla, käyttää allowlistattuja kohteita ja kirjaa audit-tiedot. Ei julkista verkkoa.
- HMAC suojaa sisäiset kutsut; shared secret -header suojaa selaimen token-pyyntöä. Rate limit on päällä molemmissa palveluissa.

## Turvamalli (tiivistelmä)

- OpenAI avain ei vuoda selaimelle: vain lyhytikäinen client_secret palautetaan.
- Kaikki endpointit vaativat autentikaation (shared secret + HMAC sisäisesti).
- Tool-gateway hylkää tuntemattomat työkalut; jokaisella työkalulla oma skeema ja aikakatkaisut.
- Lokit redaktoidaan (API-avaimet, JWT:t) ja korreloidaan session- ja request-id:llä. Mikrofonin raakaa audioa ei logata.

## Työkalujen allowlist ja uudet työkalut

Tool-gateway rekisteröi työkalut `apps/tool-gateway/src/tools/index.ts` -tiedostossa. Jokainen työkalu palauttaa `{ name, schema, handler }`. Luo uusi moduuli `tools/`-hakemistoon, lisää skeema ja handler, ja lisää se `buildTools`-funktioon. Vain tunnistetut työkalut hyväksytään.

## Saatavilla olevat esimerkkityökalut

- `http_fetch`: GET vain `ALLOWLIST_HTTP_HOSTS`-listan hosteihin.
- `home_assistant_sensor`: lukee Home Assistantin sensorin tilan (read-only).
- `note_writer`: tallentaa muistiinpanon paikalliseen SQLiteen kovakoodattuun sijaintiin.

## Testaus ja laadunvarmistus

- `pnpm test` ajaa Vitestit (HMAC- ja skeemavalidoinnit, työkalujen allowlist-käyttäytyminen).
- GitHub Actions -workflow rakentaa ja testaa kaikki workspace-projektit.

## Uhkamalli (laajennettu)

- **Salaisuudet**: API-avaimet redaktoidaan logeista, eikä niitä palauteta selaimelle. Ephemeraaliavain vanhenee 60–120s.
- **Työkalut**: vain allowlistatut, skeemavalidoidut työkalut. Ei geneeristä shelliä. HTTP-työkalussa host-allowlist; Home Assistant read-only; muistiinpanot tallentuvat rajattuun sijaintiin.
- **Verkkoraja**: tool-gateway ei ole julkinen; sisäiset kutsut allekirjoitetaan HMAC:lla (tai mTLS tulevaisuudessa). CORS on tiukka webille.
- **Rate limit**: per-IPA/asiakas peltetään Koa-rate-limitillä. Aikakatkaisut ulkoisiin kutsuihin.

## Uuden työkalun lisääminen

1. Luo tiedosto `apps/tool-gateway/src/tools/<tool>.ts` ja määrittele `schema` (Zod) ja `handler`.
2. Lisää työkalu `buildTools`-funktioon `index.ts`:ssa.
3. Päivitä tarvittaessa `ALLOWLIST_HTTP_HOSTS` tai muut ympäristömuuttujat `.env`-tiedostoon.
4. Lisää testit `src/tools/*.test.ts`.
