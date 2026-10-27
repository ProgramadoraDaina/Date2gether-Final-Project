#!/usr/bin/env python3
"""Generate private deployment configuration; never print secrets or overwrite them."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-ip', required=True)
    parser.add_argument('--private-ip', required=True)
    parser.add_argument('--domain', default='', help='Base DNS name; defaults to IP.sslip.io for a demo')
    parser.add_argument('--participants', type=int, default=6, choices=range(2, 21))
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent / 'runtime')
    args = parser.parse_args()
    public_ip = str(ipaddress.IPv4Address(args.public_ip))
    private_ip = str(ipaddress.IPv4Address(args.private_ip))
    domain = args.domain or public_ip + '.sslip.io'
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', domain) or '..' in domain or len(domain) > 200:
        parser.error('Use a DNS name, without protocol, path, or port')
    hosts = {key: key + '.' + domain for key in ('app', 'media', 'turn')}
    output = args.output
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    env_path = output / 'runtime.env'
    if env_path.exists():
        env = dict(line.split('=', 1) for line in env_path.read_text().splitlines() if line and not line.startswith('#'))
        required = ('POSTGRES_PASSWORD', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET')
        if any(not env.get(key) for key in required):
            raise SystemExit('Existing runtime.env is incomplete; preserve it and repair it before continuing')
    else:
        env = {key: secrets.token_hex(32) for key in ('POSTGRES_PASSWORD', 'LIVEKIT_API_SECRET', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET')}
        env['LIVEKIT_API_KEY'] = 'date2gether-' + secrets.token_hex(8)
    env.update({
        'POSTGRES_USER': 'date2gether', 'POSTGRES_DB': 'date2gether',
        'DATABASE_URL': 'postgresql://date2gether:' + env['POSTGRES_PASSWORD'] + '@127.0.0.1:5432/date2gether',
        'PORT': '3001', 'CORS_ORIGIN': 'https://' + hosts['app'],
        'JWT_ACCESS_EXPIRES_IN': '15m', 'JWT_REFRESH_EXPIRES_IN': '7d',
        'LIVEKIT_URL': 'wss://' + hosts['media'], 'LIVEKIT_API_URL': 'http://127.0.0.1:7880',
        'MAX_ROOM_PARTICIPANTS': str(args.participants),
    })
    env_path.write_text(''.join(key + '=' + value + '\n' for key, value in env.items()))
    # JSON is valid YAML and avoids templating credentials into shell code.
    livekit = {
        'port': 7880,
        'rtc': {'tcp_port': 7881, 'udp_port': 7882, 'node_ip': public_ip, 'use_external_ip': False},
        'keys': {env['LIVEKIT_API_KEY']: env['LIVEKIT_API_SECRET']},
        'room': {'auto_create': False, 'max_participants': args.participants, 'empty_timeout': 300, 'departure_timeout': 30},
        'turn': {'enabled': True, 'domain': hosts['turn'], 'external_tls': True, 'tls_port': 5349, 'udp_port': 3478},
        'logging': {'level': 'warn'},
    }
    # SNI/TURN routing follows github.com/livekit/deploy/generate/templates/caddy.go.
    # A private IPv4 TURN upstream (rather than loopback) supports Firefox.
    def tls_route(host, upstream):
        return {'match': [{'tls': {'sni': [host]}}], 'handle': [
            {'handler': 'tls', 'connection_policies': [{'alpn': ['http/1.1']}]},
            {'handler': 'proxy', 'upstreams': [{'dial': [upstream]}]},
        ]}
    routes = [tls_route(hosts['turn'], private_ip + ':5349'), tls_route(hosts['media'], '127.0.0.1:7880'), tls_route(hosts['app'], '127.0.0.1:8080')]
    # TURN does not use HTTP ALPN negotiation.
    routes[0]['handle'][0].pop('connection_policies')
    caddy = {
        'admin': {'listen': '127.0.0.1:2019'},
        'storage': {'module': 'file_system', 'root': '/data'},
        'logging': {'logs': {'default': {'level': 'WARN'}}},
        'apps': {
            'tls': {'certificates': {'automate': list(hosts.values())}},
            'layer4': {'servers': {'main': {'listen': [':443'], 'routes': routes}}},
            'http': {'servers': {'application': {
                'listen': ['127.0.0.1:8080'],
                'routes': [
                    {'match': [{'path': ['/api/*']}], 'handle': [
                        {'handler': 'rewrite', 'strip_path_prefix': '/api'},
                        {'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:3001'}], 'headers': {'request': {'set': {'X-Forwarded-Proto': ['https']}}}},
                    ]},
                    {'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': '127.0.0.1:3002'}]}]},
                ],
            }}},
        },
    }
    (output / 'livekit.yaml').write_text(json.dumps(livekit, indent=2) + '\n')
    (output / 'caddy.json').write_text(json.dumps(caddy, indent=2) + '\n')
    for path in output.iterdir():
        if path.is_file():
            os.chmod(path, 0o600)
    print('Application URL: https://' + hosts['app'])
    print('LiveKit URL: wss://' + hosts['media'])
    print('Configuration saved with private permissions; existing secrets preserved.')


if __name__ == '__main__':
    main()
