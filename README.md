# Interuniversity Investment Challenge 2026/2027

Piattaforma completa per la sfida: sito per i team (ordini, portafoglio, sotto-portafogli per valuta), classifica pubblica A e B, pannello admin e motore di calcolo automatico che gira due volte al giorno.

Costo: zero (Supabase Free, Cloudflare Pages Free, GitHub). Paghi solo un eventuale dominio.

## Come è fatta

| Parte | Dove gira | Cosa fa |
|---|---|---|
| `web/` | Cloudflare Pages | Sito React: home, classifica, area team, admin |
| `supabase/migrations/` | Supabase (Postgres) | Tabelle, permessi (RLS), funzioni per ordini e motore |
| `supabase/functions/engine` | Supabase Edge Functions | Scarica prezzi (Yahoo) e cambi (BCE), ricalcola tutto, avvisa su Telegram |
| `supabase/functions/market-data` | Supabase Edge Functions | Ricerca e validazione titoli per i team |
| `supabase/functions/admin` | Supabase Edge Functions | Creazione account dei team |
| `supabase/functions/_shared/core.ts` | ovunque | Il motore di calcolo, puro e testato |
| `.github/workflows/` | GitHub Actions | Pubblicazione automatica su Supabase, piano B del motore |

Regole implementate: ordini eseguiti alla chiusura del primo giorno di borsa del mese sulla borsa del titolo; stop short a +50% con perdita bloccata al 50% anche in caso di gap (lo stop viene controllato prima degli ordini); sotto-portafogli per valuta con cassa che può essere negativa, senza margini e interessi; dividendi accreditati sulle long e addebitati sulle short; split; conversione in euro ai cambi BCE; benchmark SWDA in USD convertito in euro; classifica per rendimento totale in euro, separata per competizione, con Sharpe, Sortino, volatilità, beta, tracking error, max drawdown, Calmar, operazioni, peso massimo, HHI, esposizione valutaria e violazioni.

Il motore ricalcola sempre tutto da zero partendo da ordini, prezzi e cambi. Ogni correzione (un prezzo inserito a mano, un ordine respinto) si propaga da sola alla corsa successiva.

## Test già superati

- `npm test`: 11 test sul motore, tra cui il caso di accettazione con 30 controlli identici al file Excel dell'organizzatore (NAV, sotto-portafogli, stop, dividendi, cambi, benchmark) e tutte le metriche di rischio confrontate con l'Excel.
- `npm run test:db`: 32 controlli sul database (permessi, regole degli ordini, scadenze, transazione di scrittura) e un giro completo del motore con dati Yahoo e BCE simulati.
- Le funzioni server superano il controllo dei tipi di Deno, e l'autotest gira anche dentro la funzione pubblicata (Admin > Engine > Run self-test).

Da qui non è stato possibile chiamare Yahoo Finance e la BCE dal vivo: il primo controllo reale lo fai al passo 9.

---

## Messa online, passo passo (circa un'ora, tutto dal browser)

### 1. GitHub

1. Crea un repository (anche privato), ad esempio `investment-challenge`.
2. Carica tutto il contenuto di questa cartella: da github.com "Add file > Upload files" e trascina i file e le cartelle, oppure usa GitHub Desktop. La cartella `.github` deve esserci (su Mac è nascosta: Cmd+Shift+. nel Finder per vederla).

### 2. Supabase

1. Su supabase.com crea un nuovo progetto (regione: Frankfurt). Annota la password del database.
2. Annota il "Project ref", cioè il codice nell'indirizzo `https://<ref>.supabase.co`.
3. Da Account (in alto a destra) > Access Tokens crea un token personale.

### 3. Collega GitHub a Supabase e pubblica

1. Nel repository GitHub: Settings > Secrets and variables > Actions > New repository secret. Crea:
   - `SUPABASE_ACCESS_TOKEN`: il token del punto 2.3
   - `SUPABASE_PROJECT_REF`: il ref del punto 2.2
   - `SUPABASE_DB_PASSWORD`: la password del database
2. Tab Actions > "Deploy Supabase" > Run workflow. In circa due minuti esegue i test del motore, crea il database e pubblica le tre funzioni. Da ora ogni modifica nella cartella `supabase/` si pubblica da sola.

### 4. Segreti delle funzioni

Supabase > Edge Functions > Secrets, aggiungi:

- `ENGINE_SECRET`: una stringa casuale lunga (ad esempio generata con un password manager). Serve al timer automatico.
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`: facoltativi, per ricevere il riepilogo di ogni corsa. Il token te lo dà @BotFather su Telegram; il chat id lo ottieni scrivendo al tuo bot e aprendo `https://api.telegram.org/bot<TOKEN>/getUpdates`.
- `SERVICE_KEY`: solo se il progetto mostra unicamente le nuove chiavi `sb_secret_...` e il motore segnala errori di autorizzazione. In quel caso incolla qui la secret key (Project Settings > API Keys).

### 5. Timer automatico

Supabase > SQL Editor: apri `supabase/cron.sql`, sostituisci `<PROJECT_REF>` e `<ENGINE_SECRET>` con i tuoi valori ed eseguilo. Il motore partirà ogni giorno alle 22:30 e alle 05:30 UTC.

### 6. Autenticazione e account admin

1. Supabase > Authentication > Sign In / Providers > Email: disattiva "Allow new users to sign up". Gli account dei team li crei tu dal pannello admin.
2. Authentication > Users > Add user: crea il tuo utente (email e password, "Auto confirm").
3. SQL Editor, con la tua email:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'la-tua-email@esempio.com';
   ```

### 7. Sito su Cloudflare Pages

1. Cloudflare > Workers & Pages > Create > Pages > Connect to Git, scegli il repository.
2. Impostazioni di build:
   - Framework preset: Vite (oppure None)
   - Root directory: `web`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Variabili d'ambiente (Production):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = la chiave anon o publishable (Project Settings > API Keys). È pubblica per natura: la sicurezza è garantita dalle regole del database.
4. Save and Deploy. Il sito è subito online su un indirizzo `*.pages.dev`.

### 8. Dominio

Cloudflare Pages > il tuo progetto > Custom domains: aggiungi il dominio nuovo o un sottodominio come `challenge.andreamuti.com`. Poi in Supabase > Authentication > URL Configuration imposta lo stesso indirizzo come Site URL.

### 9. Collaudo dal vivo (non saltarlo)

1. Accedi con il tuo account admin e vai su Admin > Engine > "Run self-test": devono risultare 30 controlli PASS.
2. Admin > Market data > "Check & add" con `VOD.L`: deve rispondere con nome, valuta GBP e ultimo prezzo in sterline. È la prova che Yahoo Finance risponde ai server di Supabase.
3. Admin > Engine > "Run engine": deve terminare con stato ok (o warning con avvisi leggibili) e la riga "ECB: … rates".
4. Crea un team di prova in Admin > Teams, crea il suo account, entra con quell'account in una finestra anonima, cerca un titolo e salva un ordine. Poi cancellalo, ed elimina il team di prova dal database (Table editor > teams) prima del 1° dicembre.
5. Carica il PDF del regolamento (ad esempio su andreamuti.com o Google Drive) e incolla il link in Admin > Calendar & settings > Regulation PDF link.

Se al punto 2 compare "Market data unavailable", Yahoo sta rifiutando le richieste da Supabase. Il workflow "Engine (GitHub fallback)" esegue lo stesso motore da GitHub (istruzioni nel file), ma anche la ricerca titoli dei team andrebbe spostata: in quel caso serve un piccolo adattamento.

---

## Uso durante la sfida

- Dopo il 15 novembre: Admin > Teams, aggiungi ogni team (competizione A o B), poi "Accounts" > "Create account" con l'email del referente. La password temporanea compare una sola volta: inviala al team, che potrà cambiarla da My team > Account.
- Gli ordini si chiudono da soli alla scadenza di ogni mese e vengono eseguiti dal motore. Non devi fare nulla.
- Ogni sera ricevi il riepilogo su Telegram. Se un titolo non ha prezzi o una valuta non è pubblicata dalla BCE, inserisci il valore in Admin > Market data e premi "Run engine".
- Violazioni (art. 13): campo Violations in Admin > Teams. Un ordine può essere respinto da Admin > Orders.
- Il risk-free (2% di default) si cambia in Admin > Calendar & settings.
- Admin > Export scarica i CSV per una verifica indipendente con il file Excel.
- I portafogli dei team restano privati fino al 31 maggio 2027, poi diventano pubblici in automatico.

## Sviluppo locale (facoltativo)

```bash
npm install          # nella cartella principale, per i test del database
npm test             # test del motore (Node 22)
npm run test:db      # database e runner su Postgres locale (PGlite)
cd web && cp .env.example .env && npm install && npm run dev
```
