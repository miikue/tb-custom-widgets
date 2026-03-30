import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WidgetContext } from '@home/models/widget-component.models';
import { firstValueFrom } from 'rxjs';

interface NotificationsPage {
  data?: NotificationApiItem[];
  totalElements?: number;
}

interface NotificationItem {
  id?: {
    id?: string;
  };
  subject?: string;
  text?: string;
  createdTime?: number;
  read?: boolean;
  status?: string;
}

interface NotificationApiItem {
  id?: string | { id?: string };
  subject?: string;
  text?: string;
  createdTime?: number;
  read?: boolean;
  status?: string;
}

@Component({
  selector: 'tb-miikue-notifikation-center',
  templateUrl: './miikue-notifikation-center.component.html',
  styleUrls: ['./miikue-notifikation-center.component.scss'],
  standalone: false
})
export class MiikueNotifikationCenterComponent implements OnInit, OnDestroy {

  @Input() ctx: WidgetContext;

  public isWidgetExpanded = false;
  public unreadCount = 0;
  public notifications: NotificationItem[] = [];
  public isLoadingNotifications = false;
  public notificationsError = '';
  public currentPage = 0;
  public totalElements = 0;
  public pageSize = 20;
  public isProcessingAction = false;

  private pollingId: number | null = null;
  private readonly pollingIntervalMs = 30 * 1000;


  constructor(private http: HttpClient) {}

  async ngOnInit(): Promise<void> {
    if (this.ctx?.$scope) {
      this.ctx.$scope.miikueNotifikationCenterWidget = this;
    }

    this.onResize();
    await this.refreshData();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  public async onResize(): Promise<void> {
    const wasExpanded = this.isWidgetExpanded;
    this.updateExpandedState();

    if (this.isWidgetExpanded && !wasExpanded) {
      this.currentPage = 0;
      await this.refreshNotifications();
    }
  }

  private updateExpandedState(): void {
    const dashboard: any = this.ctx?.dashboard;

    if (typeof dashboard?.isWidgetExpanded === 'boolean') {
      this.isWidgetExpanded = dashboard.isWidgetExpanded;
      return;
    }

    // If TB does not provide the fullscreen flag, keep collapsed by default.
    this.isWidgetExpanded = false;
  }

  public get collapsedUnreadText(): string {
    if (this.unreadCount <= 0) {
      return '0';
    }
    if (this.unreadCount > 99) {
      return '99+';
    }
    return String(this.unreadCount);
  }

  public formatNotificationTime(value?: number): string {
    if (!value) {
      return '';
    }
    return new Date(value).toLocaleString('cs-CZ');
  }

  public isUnread(item?: NotificationItem): boolean {
    if (!item) {
      return false;
    }

    // ThingsBoard 4.3.1: status === 'SENT' means unread
    if (typeof item.read === 'boolean') {
      return item.read === false;
    }

    const status = String(item.status || '').toUpperCase();
    return status === 'SENT' || status === 'UNREAD';
  }

  public get totalPages(): number {
    return Math.ceil(this.totalElements / this.pageSize) || 1;
  }

  public get hasNextPage(): boolean {
    return this.currentPage < this.totalPages - 1;
  }

  public get hasPrevPage(): boolean {
    return this.currentPage > 0;
  }

  public async nextPage(): Promise<void> {
    if (this.hasNextPage) {
      this.currentPage++;
      await this.loadPage();
    }
  }

  public async prevPage(): Promise<void> {
    if (this.hasPrevPage) {
      this.currentPage--;
      await this.loadPage();
    }
  }

  public async loadPage(): Promise<void> {
    await this.refreshNotifications();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollingId = window.setInterval(() => {
      void this.refreshData();
    }, this.pollingIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollingId !== null) {
      clearInterval(this.pollingId);
      this.pollingId = null;
    }
  }

  private async refreshData(): Promise<void> {
    await this.refreshUnreadCount();
    if (this.isWidgetExpanded) {
      this.currentPage = 0; // Reset to first page on polling update
      await this.refreshNotifications();
    }
  }

  private async refreshUnreadCount(): Promise<void> {
    try {
      let resolvedCount = await this.fetchUnreadCountPrimary();

      if (resolvedCount === null) {
        resolvedCount = await this.fetchUnreadCountFallbackFromPage();
      }

      if (resolvedCount !== null) {
        this.unreadCount = resolvedCount;
      }

      this.ctx?.detectChanges?.();
    } catch {
      // Keep last known value when request fails instead of forcing 0.
      this.ctx?.detectChanges?.();
    }
  }

  private async fetchUnreadCountPrimary(): Promise<number | null> {
    const url = '/api/notifications?pageSize=1&page=0&unreadOnly=true&sortProperty=createdTime&sortOrder=DESC';
    const page = await this.apiGet<NotificationsPage>(url);

    if (typeof page?.totalElements === 'number') {
      return page.totalElements;
    }

    if (Array.isArray(page?.data)) {
      return page.data.length;
    }

    return null;
  }

  private async fetchUnreadCountFallbackFromPage(): Promise<number | null> {
    const url = '/api/notifications/unread/count';
    const response = await this.apiGet<unknown>(url);
    return this.extractUnreadCount(response);
  }

  private extractUnreadCount(response: any): number | null {
    if (typeof response === 'number') {
      return response;
    }

    if (!response || typeof response !== 'object') {
      return null;
    }

    const candidates: unknown[] = [
      response.totalUnreadCount,
      response.unreadCount,
      response.count,
      response?.data?.totalUnreadCount,
      response?.data?.unreadCount,
      response?.data?.count
    ];

    for (const value of candidates) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  private async refreshNotifications(): Promise<void> {
    this.isLoadingNotifications = true;
    this.notificationsError = '';
    this.ctx?.detectChanges?.();

    try {
      const url = `/api/notifications?pageSize=${this.pageSize}&page=${this.currentPage}&sortProperty=createdTime&sortOrder=DESC`;
      const page = await this.apiGet<NotificationsPage>(url);
      if (Array.isArray(page?.data)) {
        this.notifications = page.data.map((item) => {
          const rawId = item?.id;
          const normalizedId = typeof rawId === 'string' ? { id: rawId } : rawId;
          const unreadByStatus = String(item?.status || '').toUpperCase() === 'UNREAD';
          const normalizedRead = typeof item?.read === 'boolean' ? item.read : !unreadByStatus;
          return {
            ...item,
            id: normalizedId,
            read: normalizedRead
          } as NotificationItem;
        });
      } else {
        this.notifications = [];
      }
      this.totalElements = page?.totalElements || 0;
    } catch {
      this.notifications = [];
      this.notificationsError = 'Nepodařilo se načíst notifikace.';
    } finally {
      this.isLoadingNotifications = false;
      this.ctx?.detectChanges?.();
    }
  }

  public async markAsRead(itemId?: string): Promise<void> {
    if (!itemId) return;
    
    this.isProcessingAction = true;
    try {
      const url = `/api/notification/${itemId}/read`;
      await this.apiPut<void>(url, {});
      
      // Update local notification
      const item = this.notifications.find(n => n?.id?.id === itemId);
      if (item) {
        item.read = true;
        item.status = 'READ';
      }
      
      // Refresh counts
      await this.refreshUnreadCount();
      this.ctx?.detectChanges?.();
    } catch (error) {
      console.error('[NotifCenter] Failed to mark as read:', error);
    } finally {
      this.isProcessingAction = false;
    }
  }

  public async markAllAsRead(): Promise<void> {
    this.isProcessingAction = true;
    try {
      const url = '/api/notifications/read';
      await this.apiPut<void>(url, {});
      
      // Mark all as read locally
      this.notifications.forEach(n => n.read = true);
      this.notifications.forEach(n => n.status = 'READ');
      this.unreadCount = 0;
      
      this.ctx?.detectChanges?.();
    } catch (error) {
      console.error('[NotifCenter] Failed to mark all as read:', error);
    } finally {
      this.isProcessingAction = false;
    }
  }

  public async deleteNotification(itemId?: string): Promise<void> {
    if (!itemId) return;
    
    this.isProcessingAction = true;
    try {
      const url = `/api/notification/${itemId}`;
      await this.apiDelete<void>(url);
      
      // Remove from local list
      this.notifications = this.notifications.filter(n => n?.id?.id !== itemId);
      this.totalElements = Math.max(0, this.totalElements - 1);
      
      // Refresh counts
      await this.refreshUnreadCount();
      this.ctx?.detectChanges?.();
    } catch (error) {
      console.error('[NotifCenter] Failed to delete notification:', error);
    } finally {
      this.isProcessingAction = false;
    }
  }

  public async deleteAllNotifications(): Promise<void> {
    this.isProcessingAction = true;
    try {
      // Delete all by deleting each one (or use batch endpoint if available)
      const deletePromises = this.notifications.map(n => {
        const itemId = n?.id?.id;
        if (itemId) {
          return this.apiDelete<void>(`/api/notification/${itemId}`).catch(() => {});
        }
        return Promise.resolve();
      });
      
      await Promise.all(deletePromises);
      
      this.notifications = [];
      this.unreadCount = 0;
      this.totalElements = 0;
      this.currentPage = 0;
      
      this.ctx?.detectChanges?.();
    } catch (error) {
      console.error('[NotifCenter] Failed to delete all notifications:', error);
    } finally {
      this.isProcessingAction = false;
    }
  }

  private async apiGet<T>(url: string): Promise<T> {
    const ctxHttp = (this.ctx as any)?.http;

    if (ctxHttp?.get) {
      return firstValueFrom(ctxHttp.get(url));
    }

    return firstValueFrom(this.http.get<T>(url));
  }

  private async apiPut<T>(url: string, body: any): Promise<T> {
    const ctxHttp = (this.ctx as any)?.http;

    if (ctxHttp?.put) {
      return firstValueFrom(ctxHttp.put(url, body));
    }

    return firstValueFrom(this.http.put<T>(url, body));
  }

  private async apiDelete<T>(url: string): Promise<T> {
    const ctxHttp = (this.ctx as any)?.http;

    if (ctxHttp?.delete) {
      return firstValueFrom(ctxHttp.delete(url));
    }

    return firstValueFrom(this.http.delete<T>(url));
  }
}
