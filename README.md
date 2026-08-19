# MyGarage for CarChief Command

> [!IMPORTANT]
> This fork is the MyGarage maintenance-history companion for
> **[CarChief Command](https://github.com/teezyyoxo/carchief-command)**, the
> BMW-specific command center. **CarChief Command is the primary integration
> target and reason this fork exists.**

Through **[Vehicle Hub](https://github.com/teezyyoxo/vehicle-hub)**, this fork
adds reviewed, bidirectional maintenance-history transfers between MyGarage
and CarChief Command without removing MyGarage features or turning Command
into a general multi-vehicle application. Transfers are deliberately limited
to maintenance service visits; photos, attachments, documents, fuel records,
telemetry, location, reminders, and vehicle-profile data do not sync.

This work is based on the original
**[MyGarage project by HomelabForge](https://github.com/homelabforge/mygarage)**
and remains available under its MIT License. The integration fork is
independent and is not endorsed by HomelabForge or CarChief.

**Primary projects:**

- **CarChief Command:** <https://github.com/teezyyoxo/carchief-command>
- **Vehicle Hub:** <https://github.com/teezyyoxo/vehicle-hub>
- **Original MyGarage:** <https://github.com/homelabforge/mygarage>

---

<div align="center">
  
Self-hosted vehicle maintenance tracking with VIN decoding, service records, fuel logging, and document management.

[![CI](https://github.com/homelabforge/mygarage/actions/workflows/ci.yml/badge.svg)](https://github.com/homelabforge/mygarage/actions/workflows/ci.yml)
[![CodeQL](https://github.com/homelabforge/mygarage/actions/workflows/codeql.yml/badge.svg)](https://github.com/homelabforge/mygarage/actions/workflows/codeql.yml)
[![Publish](https://github.com/homelabforge/mygarage/actions/workflows/publish.yml/badge.svg)](https://github.com/homelabforge/mygarage/actions/workflows/publish.yml)
[![Translations](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/homelabforge/mygarage/main/.github/badges/translations.json)](TRANSLATIONS.md)

[![Docker](https://img.shields.io/badge/Docker-Available-2496ED?logo=docker&logoColor=white)](https://github.com/homelabforge/mygarage/pkgs/container/mygarage)
[![Python 3.14](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Bun](https://img.shields.io/badge/dynamic/regex?url=https://raw.githubusercontent.com/homelabforge/mygarage/main/.bun-version&search=^([\d.]%2B)&label=Bun&color=000000&logo=bun&logoColor=white&prefix=v)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/6XttnVgG)

![MyGarage Dashboard](docs/screenshots/dashboard.png)

</div>

---

## Key Features

- **VIN Decoding** - Automatic vehicle details via NHTSA API
- **Service Visits** - Track maintenance with line items, tax/fees, and attachments
- **Reminders** - Date, mileage, or engine-hours maintenance reminders with due alerts
- **LiveLink Telemetry** - Real-time OBD2 data, drive sessions, GPS trips, and DTCs via a WiCAN device (HTTPS POST or MQTT) or the Torque Pro app. See [LiveLink (WiCAN) Setup](docs/LIVELINK_SETUP.md).
- **POI Finder** - Discover nearby auto shops, EV charging, and fuel stations with interactive map
- **Fuel & DEF Tracking** - Log fill-ups (and DEF for diesels) and analyze fuel economy trends
- **Engine Hours Tracking** - Hour meters for ATVs, equipment, and generators, with hours-based reminders
- **Parts & Supplies** - Track fluids, filters and parts on hand; their cost folds into service visits
- **Fifth Wheel & Trailer Support** - Propane tracking, spot rental billing, and RV park management
- **Unit Conversion** - Imperial/Metric units with per-user preferences
- **Document Management** - Store registration, insurance, manuals with OCR
- **PDF Import** - Import a vehicle PDF with OCR; the original is saved as a document and extracted text is added to vehicle notes. Use JSON import for complete data backups.
- **Family Multi-User System** - Separate accounts with vehicle sharing, ownership transfers, and family dashboard
- **Languages & Currencies** - English, German, French, Polish, Brazilian Portuguese, Russian, Ukrainian; 16 currencies
- **Authentication Options** - No auth, local JWT, or OIDC (Authentik, Keycloak, Google, Azure AD)
- **Self-Hosted** - Your data stays on your infrastructure

---

**Default Mode**: Runs with no authentication for easy setup. Configure authentication in Settings before exposing to the internet.

## Deployment and build identity

In this Vehicle Hub deployment, MyGarage is the user-facing maintenance
application. Vehicle Hub itself has no dedicated interface; it provides the
gateway and API backbone connecting MyGarage with CarChief Command.

Build MyGarage with an explicit commit ID so the top navigation always shows
which source revision is running:

```sh
cd /path/to/vehicle-hub
BUILD_COMMIT=$(git rev-parse --short HEAD) \
	podman compose up -d --build mygarage vehicle-hub-sync vehicle-hub-gateway
```

`BUILD_COMMIT` is required by the root Compose deployment. The displayed
application version comes from MyGarage's package version, while the commit
identifies the deployed build. Use the same command after changing either the
Vehicle Hub files or the MyGarage submodule.

📖 **[Complete Installation Guide](https://github.com/homelabforge/mygarage/wiki/Installation)**

---

## Vehicle Hub and CarChief Command integration

Current MyGarage fork version: **3.1.1**

This Vehicle Hub-maintained fork adds an optional, reviewed connection between
MyGarage service history and the BMW-specific
[CarChief Command](https://github.com/teezyyoxo/carchief-command) application.
MyGarage remains the multi-vehicle ownership platform; Command remains unique
to the single configured BMW.

The integration synchronizes **only maintenance service visits**. Supported
fields are the service date, mileage recorded for that service, category/type,
description/sub-type, notes, provider and invoice context, and cost. The
service mileage is part of the historical visit and does not synchronize a
standalone current-odometer record.

It does **not** synchronize vehicle photos, service attachments, documents,
fuel/DEF/propane records, reminders, telemetry, trips, locations, DTCs,
standalone odometer observations, vehicle profile/specification data, or any
other MyGarage vehicle. Nothing is written upstream to CarChief, and deletes
are never propagated.

Use **Send to Command** on one visit or the service-history list to open a
zero-write preview. Every actionable record requires an explicit decision.
Possible duplicates offer Merge, Replace, Keep Both, Link Without Changes,
Ignore Once, and Never Sync rather than being overwritten automatically.
Records imported from Command show `Imported from Command`, remain read-only
in MyGarage, and must be changed in their owning application before being
transferred again.

Vehicle Hub's root Compose configuration supplies the private adapter URL,
exact VIN, and file-mounted shared token through these MyGarage settings:

```dotenv
MYGARAGE_VEHICLE_HUB_URL=http://vehicle-hub-sync:8788
MYGARAGE_VEHICLE_HUB_VEHICLE_VIN=YOUR_17_CHARACTER_VIN
MYGARAGE_VEHICLE_HUB_SYNC_TOKEN_FILE=/run/secrets/vehicle_hub_sync_token
MYGARAGE_VEHICLE_HUB_TIMEOUT_SECONDS=15
```

The browser never receives the shared token. If the integration settings are
absent, MyGarage continues to operate independently.

---

## Support

- **📚 Documentation**: [GitHub Wiki](https://github.com/homelabforge/mygarage/wiki)
- **🌐 Website**: [homelabforge.io/builds/mygarage](https://homelabforge.io/builds/mygarage/)
- **🐛 Bug Reports**: [GitHub Issues](https://github.com/homelabforge/mygarage/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/homelabforge/mygarage/discussions)

---

## Translations

See [Translation Status](TRANSLATIONS.md) for language support and how to contribute.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Built for homelabbers who want to track vehicle maintenance without sending data to third-party services.

VIN decoding powered by the [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/).

### Development Assistance

MyGarage was developed through AI-assisted pair programming with **Claude** and **Codex**, combining human vision with AI capabilities for architecture, security patterns, and implementation.
