#!/bin/bash
#add screen
echo "Executing Nord VPN"
nordvpn connect us4391
echo "Executing Python"
python3.8 /home/ubuntu/point_bot/src/point_bot/main.py
echo "Disconnecting VPN"
nordvpn disconnect