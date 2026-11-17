// Másold le config.h néven, és töltsd ki (a config.h nem kerül a git-be).
// Az értékek az org-app/.env.local fájlban vannak:
//   NEXT_PUBLIC_SUPABASE_URL      → SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY → SUPABASE_ANON_KEY
// (Az anon kulcs nyilvános kulcs, a böngésző is ezt használja; a panelt az
//  eszközkulcs azonosítja, amit telefonról adsz meg beállításkor.)
#pragma once
#define SUPABASE_URL      "https://xxxxxxxxxxxxxxxxxxxx.supabase.co"
#define SUPABASE_ANON_KEY "eyJ..."
