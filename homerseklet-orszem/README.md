# Második ellenőr a printszerveren

A printszerver (Ubuntu, 192.168.191.249) 2 percenként megnézi, fut-e a felhőben a
riasztó-ellenőrzés. Ha nem, saját maga küld Telegram-üzenetet.

## Telepítés (a printszerveren)

```bash
sudo install -m 755 orszem.sh /usr/local/bin/fs-homero-orszem
sudo cp orszem.env.example /etc/fs-homero-orszem.env
sudo chmod 600 /etc/fs-homero-orszem.env
sudo nano /etc/fs-homero-orszem.env      # kitöltés
sudo cp fs-homero-orszem.service fs-homero-orszem.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fs-homero-orszem.timer
```

Próba: `sudo /usr/local/bin/fs-homero-orszem; cat /var/lib/fs-homero-orszem/state`
