#!/bin/bash
#add screen
echo "Executing Nord VPN"
nordvpn connect us5215
echo "Executing Python"
#python3.8 /home/ubuntu/point_bot/point_bot/main.py
python3.8 /Users/jckail13/pointly/point_bot/point_bot/main.py
echo "Disconnecting VPN"
nordvpn disconnect