package com.palladium.backend;

import com.sun.net.httpserver.HttpExchange;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * Security helpers for request identity and outbound target validation.
 *
 * <p>These helpers support production hardening by:
 * resolving stable client IP identifiers (optionally via proxy headers),
 * and blocking private/local network fetch targets to reduce SSRF risk.</p>
 */
final class RequestSecurity {
    private RequestSecurity() {
    }

    /**
     * Resolves a client identifier string from an incoming HTTP exchange.
     *
     * @param exchange incoming exchange
     * @param trustProxyHeaders when true, first value of {@code X-Forwarded-For} is used when present
     * @return normalized client identifier, never blank
     */
    static String resolveClientIdentifier(HttpExchange exchange, boolean trustProxyHeaders) {
        if (trustProxyHeaders) {
            String forwardedFor = exchange.getRequestHeaders().getFirst("x-forwarded-for");
            String parsed = parseForwardedFor(forwardedFor);
            if (!parsed.isBlank()) {
                return parsed;
            }
        }
        InetAddress remoteAddress = exchange.getRemoteAddress().getAddress();
        if (remoteAddress != null) {
            return remoteAddress.getHostAddress();
        }
        String host = exchange.getRemoteAddress().getHostString();
        return host == null || host.isBlank() ? "unknown" : host;
    }

    /**
     * Determines whether a proxy target URI should be blocked due to private/local destination rules.
     *
     * @param target target URI
     * @param blockPrivateNetworks whether private/local targets should be rejected
     * @return {@code true} when target must be blocked
     */
    static boolean isBlockedProxyTarget(URI target, boolean blockPrivateNetworks) {
        if (!blockPrivateNetworks) {
            return false;
        }

        String host = target.getHost();
        if (host == null || host.isBlank()) {
            return true;
        }

        String loweredHost = host.toLowerCase(Locale.ROOT).trim();
        if (
                "localhost".equals(loweredHost)
                        || loweredHost.endsWith(".localhost")
                        || "0.0.0.0".equals(loweredHost)
                        || "::".equals(loweredHost)
                        || "::1".equals(loweredHost)
        ) {
            return true;
        }

        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            for (InetAddress address : addresses) {
                if (isPrivateOrLocalAddress(address)) {
                    return true;
                }
            }
        } catch (UnknownHostException ignored) {
            // Allow unresolved hostnames; upstream request execution may still fail.
        }

        return false;
    }

    private static String parseForwardedFor(String forwardedFor) {
        if (forwardedFor == null || forwardedFor.isBlank()) {
            return "";
        }
        String[] values = forwardedFor.split(",");
        if (values.length == 0) {
            return "";
        }
        return values[0].trim();
    }

    private static boolean isPrivateOrLocalAddress(InetAddress address) {
        if (
                address.isAnyLocalAddress()
                        || address.isLoopbackAddress()
                        || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress()
                        || address.isMulticastAddress()
        ) {
            return true;
        }

        if (address instanceof Inet4Address ipv4Address) {
            byte[] b = ipv4Address.getAddress();
            int first = Byte.toUnsignedInt(b[0]);
            int second = Byte.toUnsignedInt(b[1]);

            if (first == 10) {
                return true;
            }
            if (first == 127) {
                return true;
            }
            if (first == 169 && second == 254) {
                return true;
            }
            if (first == 172 && second >= 16 && second <= 31) {
                return true;
            }
            if (first == 192 && second == 168) {
                return true;
            }
            if (first == 100 && second >= 64 && second <= 127) {
                return true;
            }
            return first == 0;
        }

        if (address instanceof Inet6Address ipv6Address) {
            byte[] b = ipv6Address.getAddress();
            int first = Byte.toUnsignedInt(b[0]);
            int second = Byte.toUnsignedInt(b[1]);

            boolean uniqueLocal = (first & 0xFE) == 0xFC;
            boolean linkLocal = first == 0xFE && (second & 0xC0) == 0x80;
            return uniqueLocal || linkLocal;
        }

        return false;
    }
}
