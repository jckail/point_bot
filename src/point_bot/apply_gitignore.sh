#!/bin/bash

echo "Removing Cache"
git rm -r --cached .
echo "Reapplying"
git add .
echo "Status"
git status