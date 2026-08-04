# Loppisjakten-agenten

Agenten körs i GitHub Actions varje dag klockan 05.15 svensk tid och kan även startas manuellt.

## Aktivera AI-uppdateringen

1. Öppna GitHub-repot och välj **Settings → Secrets and variables → Actions**.
2. Skapa en repository secret med namnet `OPENAI_API_KEY` och din OpenAI API-nyckel som värde.
3. Öppna **Actions → Uppdatera loppmarknader → Run workflow** för den första körningen.

Modellen kan bytas med en repository variable som heter `OPENAI_MODEL`. Standardvärdet är `gpt-5`.

Agenten lämnar befintlig data orörd om nyckeln saknas, ingen verifierbar loppis hittas eller en körning misslyckas. API-nyckeln skickas aldrig till webbläsaren eller webbplatsens filer.
