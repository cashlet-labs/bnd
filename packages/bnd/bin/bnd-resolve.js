#!/usr/bin/env node
// Launcher for the bnd-resolve command. It is committed, unlike dist/, so npm
// always finds the bin file when it reads package.json, even before a build.
import "../dist/did/cli.js";
