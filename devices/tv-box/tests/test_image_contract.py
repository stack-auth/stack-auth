from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROOTFS = ROOT / "image" / "rootfs"


class ImageContractTests(unittest.TestCase):
    def test_services_use_the_persistent_cookie_jar_and_production_url(self) -> None:
        launcher = (ROOTFS / "usr/lib/hexclave-tv-box/kiosk-launch").read_text(encoding="utf-8")
        self.assertIn("/var/lib/hexclave-tv-box/browser", launcher)
        self.assertIn("/run/hexclave-tv-box-browser-cache", launcher)
        self.assertIn("XDG_DATA_HOME", launcher)
        self.assertIn("XDG_CONFIG_HOME", launcher)
        self.assertIn("--webprocess-failure=exit", launcher)
        self.assertNotIn("--remote-debugging", launcher)
        network_agent = (ROOT / "src/hexclave_tv_box/network_agent.py").read_text(encoding="utf-8")
        self.assertIn('PRODUCTION_URL = "https://app.hexclave.com/tv-box"', network_agent)
        kiosk = (ROOTFS / "etc/systemd/system/hexclave-tv-box-kiosk.service").read_text(encoding="utf-8")
        self.assertIn("Restart=always", kiosk)
        self.assertIn("StartLimitAction=reboot", kiosk)
        self.assertIn("RuntimeDirectory=hexclave-tv-box-browser-cache", kiosk)
        for service_name in ("hexclave-tv-box-network.service", "hexclave-tv-box-setup.service"):
            service = (ROOTFS / "etc/systemd/system" / service_name).read_text(encoding="utf-8")
            self.assertIn("Restart=", service)
            self.assertIn("StartLimitAction=reboot", service)
            self.assertIn("PYTHONDONTWRITEBYTECODE=1", service)

    def test_unique_identity_and_network_profiles_live_outside_the_base_image(self) -> None:
        layer = (ROOT / "image/layer/hexclave-tv-box-pilot.yaml").read_text(encoding="utf-8")
        metadata = layer.split("# METAEND", maxsplit=1)[0]
        self.assertNotIn("network-manager", metadata)
        self.assertIn("# X-Env-Layer-Provides: network-activator", metadata)
        self.assertIn("    - network-manager", layer)
        self.assertIn(': > "$1/etc/machine-id"', layer)
        self.assertIn(': > "$1/etc/hostname"', layer)
        self.assertIn("bluetooth.service hciuart.service", layer)
        self.assertIn("apt-daily.timer apt-daily-upgrade.timer", layer)
        self.assertIn("dtoverlay=disable-bt", layer)
        self.assertIn('rm -f "$1/var/lib/dbus/machine-id" "$1/var/lib/systemd/random-seed"', layer)
        self.assertIn("ln -s /var/lib/hexclave-tv-box/network-connections", layer)
        build = (ROOT / "scripts/build-image.sh").read_text(encoding="utf-8")
        self.assertIn("status --porcelain --untracked-files=all", build)

    def test_pi_zero_image_prebuilds_bounded_state_and_swap_without_runtime_repartitioning(self) -> None:
        config = (ROOT / "image/config/hexclave-tv-box-pilot.yaml").read_text(encoding="utf-8")
        self.assertIn("layer: hexclave-tv-box-image", config)
        self.assertIn("state_part_size: 1G", config)
        self.assertIn("swap_part_size: 2G", config)
        image = (ROOT / "image/image/hexclave-tv-box-image/genimage.cfg.in.ext4").read_text(encoding="utf-8")
        self.assertIn('partition-table-type = "mbr"', image)
        self.assertIn("partition tvbox-state", image)
        self.assertIn("partition tvbox-swap", image)
        setup = (ROOT / "image/image/hexclave-tv-box-image/setup.sh").read_text(encoding="utf-8")
        self.assertIn("/var/lib/hexclave-tv-box/journal /var/log/journal", setup)
        self.assertFalse((ROOTFS / "etc/systemd/system/hexclave-tv-box-storage.service").exists())
        self.assertEqual(list((ROOTFS / "etc/systemd/repart.d").glob("*.conf")), [])

    def test_image_scripts_generate_mounts_and_an_initialized_swap_image(self) -> None:
        image_root = ROOT / "image/image/hexclave-tv-box-image"
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            filesystem = temporary_root / "rootfs"
            output = temporary_root / "output"
            genimage_input = temporary_root / "input"
            (filesystem / "etc").mkdir(parents=True)
            (filesystem / "boot/firmware").mkdir(parents=True)
            (filesystem / "boot/firmware/cmdline.txt").write_text("console=tty1 root=/dev/old rw\n", encoding="utf-8")
            output.mkdir()
            genimage_input.mkdir()
            (output / "tvbox_image_uuids").write_text(
                "BOOT_LABEL=1234ABCD\nBOOT_UUID=1234-ABCD\nROOT_UUID=11111111-1111-1111-1111-111111111111\n",
                encoding="utf-8",
            )
            environment = {
                **os.environ,
                "IGconf_image_outputdir": str(output),
                "IGconf_image_swap_part_size": "8M",
                "IGconf_fs_ext4_mkfs_args": "-F -b 4096",
                "IGconf_device_sector_size": "512",
                "IGconf_image_name": "test-tv-box",
                "IGconf_image_suffix": "img",
                "IGconf_image_boot_part_size": "256M",
                "IGconf_image_root_part_size": "6G",
                "IGconf_image_state_part_size": "1G",
            }
            subprocess.run(
                [str(image_root / "setup.sh"), "ROOT"],
                cwd=image_root,
                env={**environment, "IMAGEMOUNTPATH": str(filesystem)},
                check=True,
            )
            subprocess.run(
                [str(image_root / "setup.sh"), "BOOT"],
                cwd=image_root,
                env={**environment, "IMAGEMOUNTPATH": str(filesystem / "boot/firmware")},
                check=True,
            )
            subprocess.run(
                [str(image_root / "pre-image.sh"), str(filesystem), str(genimage_input)],
                cwd=image_root,
                env=environment,
                check=True,
            )
            fstab = (filesystem / "etc/fstab").read_text(encoding="utf-8")
            self.assertIn("LABEL=TVBOX_STATE", fstab)
            self.assertIn("LABEL=TVBOX_SWAP", fstab)
            self.assertIn("/var/lib/hexclave-tv-box/journal", fstab)
            self.assertIn("root=LABEL=ROOT", (filesystem / "boot/firmware/cmdline.txt").read_text(encoding="utf-8"))
            self.assertIn("partition-table-type = \"mbr\"", (genimage_input / "genimage.cfg").read_text(encoding="utf-8"))
            swap_type = subprocess.check_output(
                ["blkid", "-p", "-s", "TYPE", "-o", "value", str(output / "tvbox.swap")],
                text=True,
            ).strip()
            self.assertEqual(swap_type, "swap")

    def test_ssh_and_firewall_have_no_password_or_debug_access(self) -> None:
        ssh = (ROOTFS / "etc/ssh/sshd_config.d/90-hexclave-tv-box.conf").read_text(encoding="utf-8")
        self.assertIn("PasswordAuthentication no", ssh)
        self.assertIn("PermitRootLogin no", ssh)
        self.assertIn("ForceCommand", ssh)
        self.assertIn("AllowTcpForwarding no", ssh)
        self.assertIn("AuthorizedKeysFile none", ssh)
        self.assertIn("PermitTTY no", ssh)
        self.assertIn("DisableForwarding yes", ssh)
        self.assertIn("PermitUserRC no", ssh)
        layer = (ROOT / "image/layer/hexclave-tv-box-pilot.yaml").read_text(encoding="utf-8")
        self.assertIn("useradd --system --password '*NP*'", layer)
        firewall = (ROOTFS / "etc/nftables.d/hexclave-tv-box.nft").read_text(encoding="utf-8")
        self.assertNotIn("8101", firewall)
        self.assertNotIn("8102", firewall)
        self.assertIn("chain forward", firewall)
        self.assertIn("policy drop", firewall)
        network_service = (ROOTFS / "etc/systemd/system/hexclave-tv-box-network.service").read_text(encoding="utf-8")
        for directive in (
            "NoNewPrivileges=yes",
            "ProtectKernelModules=yes",
            "ProtectKernelTunables=yes",
            "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK",
        ):
            self.assertIn(directive, network_service)

    def test_image_verifier_rejects_initialized_state_and_hashes_the_disk_image(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            image = temporary_root / "tv-box.img"
            rootfs = temporary_root / "rootfs"
            state = temporary_root / "state"
            output = temporary_root / "verification"
            image.write_bytes(b"pilot-image")
            for path in (
                "usr/lib/hexclave-tv-box/kiosk-launch",
                "usr/lib/python3/dist-packages/hexclave_tv_box/network_agent.py",
                "etc/systemd/system/hexclave-tv-box-kiosk.service",
                "etc/hexclave-tv-box-release",
            ):
                target = rootfs / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture\n", encoding="utf-8")
            support_ca = rootfs / "etc/ssh/hexclave-support-ca.pub"
            support_ca.parent.mkdir(parents=True, exist_ok=True)
            support_ca.write_text(
                "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPilotPublicKeyMaterial fixture\n",
                encoding="utf-8",
            )
            (rootfs / "etc/machine-id").write_text("", encoding="utf-8")
            (rootfs / "var/lib/hexclave-tv-box/network-connections").mkdir(parents=True)
            (rootfs / "etc/NetworkManager").mkdir(parents=True)
            (rootfs / "etc/NetworkManager/system-connections").symlink_to(
                "/var/lib/hexclave-tv-box/network-connections",
                target_is_directory=True,
            )
            (state / "journal").mkdir(parents=True)
            (state / "network-connections").mkdir()

            command = [str(ROOT / "scripts/verify-image.sh"), str(image), str(rootfs), str(state), str(output)]
            subprocess.run(command, check=True)
            self.assertIn("tv-box.img", (output / "disk-image-sha256.txt").read_text(encoding="utf-8"))
            self.assertTrue((output / "state-sha256.txt").exists())

            (state / "identity").mkdir()
            (state / "identity/device-id").write_text("cloned", encoding="utf-8")
            rejected = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("initialized device data", rejected.stdout)

    def test_pilot_document_keeps_phase_two_gates_explicit(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        for gate in ("read-only-root", "signed image", "physical customer reset", "full GA fault-injection"):
            self.assertIn(gate, readme)
        ga_gates = (ROOT / "GA_GATES.md").read_text(encoding="utf-8")
        for gate in ("A/B", "802.1X", "25 abrupt power cuts", "72-hour", "penetration-test"):
            self.assertIn(gate, ga_gates)
        runbook = (ROOT / "PILOT_RUNBOOK.md").read_text(encoding="utf-8")
        for gate in ("Cold boot", "Unpair", "five controlled abrupt power cuts", "24 continuous hours"):
            self.assertIn(gate, runbook)


if __name__ == "__main__":
    unittest.main()
