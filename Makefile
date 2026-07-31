VERSION := $(shell grep -oP '"version": "\K[^"]+' manifest.json)

.PHONY: help install icons package clean

help:
	@echo "chrome-xray v$(VERSION) — commands"
	@echo ""
	@echo "  make install   - how to load the unpacked extension in Chrome"
	@echo "  make icons     - regenerate PNG icons from icon.svg"
	@echo "  make package   - create a versioned .zip for distribution"
	@echo "  make clean     - remove build artifacts"

install:
	@echo "1. Open chrome://extensions/"
	@echo "2. Enable 'Developer mode'"
	@echo "3. 'Load unpacked' -> $(PWD)"

icons:
	@rsvg-convert -w 16  -h 16  icons/icon.svg -o icons/icon16.png
	@rsvg-convert -w 48  -h 48  icons/icon.svg -o icons/icon48.png
	@rsvg-convert -w 128 -h 128 icons/icon.svg -o icons/icon128.png
	@echo "Icons regenerated."

package: clean
	@zip -r chrome-xray-$(VERSION).zip \
		manifest.json background.js db.js content lib overlay popup sidepanel styles icons \
		README.md LICENSE \
		-x "*.DS_Store"
	@echo "Packaged chrome-xray-$(VERSION).zip"

clean:
	@rm -f chrome-xray-*.zip
	@echo "Clean."
