# MARKET QAÇIŞI

3D, birinci şəxsdən (first person), onlayn komanda oyunu.

**Süjet:** Ananın verdiyi 30 ərzaqlıq siyahını almaq üçün dostlarınla marketə gedirsən. Amma bir həftə əvvəl stəkanları sındırdığınıza görə mühafizə sizi içəri buraxmır və tutmağa çalışır.

## Qaydalar

| | Dostlar (5 nəfərə qədər) | Polis (3 nəfərə qədər) |
|---|---|---|
| Məqsəd | Siyahıdakı 30 ərzağın hamısını yığmaq | Bütün dostları tutub türməyə salmaq |
| Hərəkət | Oyun başlayanda dərhal qaçır | İlk 10 saniyə gözləyir |
| Əsas düymə | `E` — yaxındakı ərzağı götür | `E` və ya sol klik — yaxındakı dostu tut |

- Tutulan dost **türməyə** düşür və hərəkət edə bilməz.
- Onu azad etmək üçün başqa **azad dost** türmənin qarşısındakı yaşıl zonada **10 saniyə fasiləsiz** dayanmalıdır. Zonadan çıxsa və ya polis onu tutsa, sayğac sıfırlanır.
- Hər 10 saniyə dolanda türməyə ən əvvəl düşən dost azad olur.
- Dostlar qazanır: 30 ərzaq yığılsa. Polis qazanır: bütün dostlar eyni anda türmədə olsa və ya 10 dəqiqə bitsə.

## İdarəetmə

`W A S D` hərəkət · `Shift` qaç (dözümlülük bitir) · `Space` tullan · `E` götür/tut · `M` mikrofonu aç/bağla · `Tab` siyahını gizlət/göstər · `Esc` pauza

## Menyu

Serveri seç (açıq serverlər siyahısı) · Server yarat · Serverə qoşul (kodla) · Profil (ad, rəng, statistika)

## Səs çat

Oyunçular arasında birbaşa (WebRTC) səs əlaqəsi var. Dostlar bir-birini həmişə eşidir, polis də öz aralarında. Polis ilə dostlar isə bir-birini yalnız **yaxında** olanda eşidir (8 metrə qədər tam, 38 metrdən sonra eşidilmir). Yəni yüksək səslə danışsan, polis səni tapa bilər.

> Brauzer mikrofona yalnız `localhost` və ya **HTTPS** üzərində icazə verir. Şəbəkədə `http://192.168...` ünvanı ilə mikrofon işləməyəcək.

## İşə salmaq

```bash
npm install
npm start
```

Sonra brauzerdə `http://localhost:3000` aç. Port dəyişmək üçün: `PORT=8080 npm start`.

### Dostlarla oynamaq

1. **Eyni Wi-Fi:** `http://<kompüterin-IP-si>:3000` — oyun işləyir, amma səs çat işləməz (HTTP).
2. **İnternet üzərindən (səs ilə):** serveri HTTPS verən bir yerdə işlət. Ən asanı:
   - Müvəqqəti: `npx localtunnel --port 3000` və ya `ngrok http 3000` — verdiyi `https://...` linki dostlara göndər.
   - Daimi: Render, Railway, Fly.io kimi Node hosting-ə yüklə (`npm start` komandası kifayətdir).

## Test rejimi

Tək başına yoxlamaq üçün server yarat, **Dost** komandasında qal və başlat. Polis olmasa da oyun başlayır (məşq kimi).

Gözləmə müddətlərini qısaltmaq üçün (yalnız test): `COUNTDOWN=2 RELEASE_SECONDS=3 npm start`

## Fayllar

- `server.js` — oyun serveri (otaqlar, komandalar, tutma, türmə, qələbə şərtləri, səs siqnalı)
- `public/map.js` — xəritə (server və klient birlikdə istifadə edir)
- `public/main.js` — 3D oyun, menyu, HUD, səs çat
- `public/index.html`, `public/style.css` — interfeys
