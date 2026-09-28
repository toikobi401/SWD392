/**
 * Hooks — the client's state layer (§7.4.1). Server state is fetched with
 * TanStack Query directly in each page (keyed by resource); the session lives
 * in AuthContext. This module is the one import point for both.
 */
export { useAuth, homeFor } from '../auth/AuthContext';
export { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
