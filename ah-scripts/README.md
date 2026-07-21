# ah-scripts — After Human voice bridge + demo orchestration

Node scripts that drive the E2B sandbox demo/live calls.
duplexnav7.mjs is the voice bridge (OpenAI realtime + screen control); rehearsal.mjs launches it; call_*.mjs handle live-call wake/share.

## Live path & deploy
The LIVE copy runs from /root/ah-scripts on the VPS, bind-mounted into the bff container at /app/ah (see docker-compose.yml). This repo dir is the version-controlled source.

To deploy an edit: copy the changed .mjs to the live dir:

    cp /root/jarvis-new/ah-scripts/duplexnav7.mjs /root/ah-scripts/

New demo/call leases pick it up on next spawn (no rebuild — it is re-read per sandbox).

Runtime files (logs, gp-profile.tgz, gp-login.json, samples) live only in /root/ah-scripts and are gitignored — never commit them.
