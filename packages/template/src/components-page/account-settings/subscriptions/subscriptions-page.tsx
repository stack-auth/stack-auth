'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { ActionCell, BadgeCell, DataTable, DataTableColumnHeader, DataTableFacetedFilter, DateCell, Skeleton, TextCell, Typography, standardFilterFn } from '@stackframe/stack-ui';
import { ColumnDef, Row } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { useStackApp, useUser } from '../../..';
import { useTranslation } from '../../../lib/translations';

type Subscription = {
  id: string,
  productName: string,
  status: 'INACTIVE' | 'ACTIVE' | 'CANCELLED' | 'TRIAL' | 'PAUSED',
  createdAt: string,
  cancelledAt?: string,
}

export function SubscriptionsPage() {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const stackApp = useStackApp();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        setLoading(true);
        // This would be replaced with an actual API call to fetch subscriptions
        // const response = await stackApp.api.get(`/users/${user.id}/subscriptions`);
        // setSubscriptions(response.data);

        // Mock data for now
        setTimeout(() => {
          setSubscriptions([
            {
              id: '1',
              productName: 'Pro Plan',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            },
            {
              id: '2',
              productName: 'Storage Add-on',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            }
          ]);
          setLoading(false);
        }, 500);
      } catch (err) {
        setError('Failed to load subscriptions');
        setLoading(false);
      }
    };

    // Use an immediately-invoked async function to handle the promise
    runAsynchronously(async () => {
      try {
        await fetchSubscriptions();
      } catch (error) {
        console.error("Error fetching subscriptions:", error);
      }
    });
  }, [user.id]);

  const getStatusLabel = (status: Subscription['status']) => {
    switch (status) {
      case 'ACTIVE': {
        return t('Active');
      }
      case 'CANCELLED': {
        return t('Cancelled');
      }
      case 'INACTIVE': {
        return t('Inactive');
      }
      case 'PAUSED': {
        return t('Paused');
      }
      case 'TRIAL': {
        return t('Trial');
      }
      default: {
        return status;
      }
    }
  };

  const handleCancelSubscription = (subscriptionId: string) => {
    // This would be replaced with an actual API call to cancel subscription
    // stackApp.api.post(`/users/${user.id}/subscriptions/${subscriptionId}/cancel`);
    alert('Cancellation would happen here');
  };

  function CancelAction({ row }: { row: Row<Subscription> }) {
    const subscription = row.original;
    if (subscription.status === 'ACTIVE') {
      return (
        <ActionCell
          items={[{
            item: t('Cancel'),
            danger: true,
            onClick: () => handleCancelSubscription(subscription.id),
          }]}
        />
      );
    }

    if (subscription.status === 'CANCELLED' && subscription.cancelledAt) {
      return (
        <div className="text-gray-500">
          {t('Ends on {{date}}', { date: new Date(subscription.cancelledAt).toLocaleDateString() })}
        </div>
      );
    }

    return null;
  }


  const columns: ColumnDef<Subscription>[] = [
    {
      accessorKey: "productName",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('Plan')} />,
      cell: ({ row }) => <TextCell>{row.original.productName}</TextCell>,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('Status')} />,
      cell: ({ row }) => <BadgeCell badges={[getStatusLabel(row.original.status)]} />,
      filterFn: standardFilterFn,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('Start Date')} />,
      cell: ({ row }) => <DateCell date={new Date(row.original.createdAt)} />,
    },
    {
      id: "actions",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('Actions')} />,
      cell: ({ row }) => <CancelAction row={row} />,
    },
  ];

  const toolbarRender = (table: any) => {
    return (
      <DataTableFacetedFilter
        column={table.getColumn("status")}
        title={t('Status')}
        options={['ACTIVE', 'TRIAL', 'CANCELLED', 'PAUSED', 'INACTIVE'].map((status) => ({
          value: status,
          label: getStatusLabel(status as Subscription['status']),
        }))}
      />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Typography type="h3" className="mb-4">{t('My Subscriptions')}</Typography>

        {loading && <SubscriptionsPageSkeleton />}

        {error && (
          <div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
            {error}
          </div>
        )}

        {!loading && !error && subscriptions.length === 0 && (
          <div className="p-6 text-center border border-gray-200 rounded-lg">
            <Typography type="p" variant="secondary" className="text-gray-500">
              {t('You don\'t have any active subscriptions.')}
            </Typography>
          </div>
        )}

        {!loading && !error && subscriptions.length > 0 && (
          <DataTable
            data={subscriptions}
            columns={columns}
            toolbarRender={toolbarRender}
            defaultColumnFilters={[]}
            defaultSorting={[{ id: 'createdAt', desc: true }]}
          />
        )}
      </div>
    </div>
  );
}

function SubscriptionsPageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-48 mb-2"/>
      <Skeleton className="h-[200px] w-full mt-1 rounded-md"/>
    </div>
  );
}
