#!/bin/bash

# Zip all files tracked by git

zip git-files.zip $(git ls-tree -r HEAD --name-only)
