import { CodeExample } from '../lib/code-examples';

export const paymentsExamples = {
  'payments': {
    'create-checkout-url': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function PurchaseButton({ productId }: { productId: string }) {
  const user = useUser({ or: 'redirect' });

  const handlePurchase = async () => {
    const checkoutUrl = await user.createCheckoutUrl({
      productId,
      returnUrl: window.location.href, // Optional: redirect back after purchase
    });
    
    // Redirect to Stripe checkout
    window.location.href = checkoutUrl;
  };

  return <button onClick={handlePurchase}>Purchase</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/purchase-button.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function PurchasePage() {
  const user = await stackServerApp.getUser({ or: 'redirect' });
  
  const checkoutUrl = await user.createCheckoutUrl({
    productId: "prod_premium_monthly",
  });
  
  return (
    <a href={checkoutUrl}>
      Upgrade to Premium
    </a>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/purchase/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";

export default function PurchaseButton({ productId }: { productId: string }) {
  const user = useUser({ or: 'redirect' });

  const handlePurchase = async () => {
    const checkoutUrl = await user.createCheckoutUrl({
      productId,
    });
    
    window.location.href = checkoutUrl;
  };

  return <button onClick={handlePurchase}>Purchase</button>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/PurchaseButton.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse
from django.shortcuts import redirect

def create_checkout(request, product_id):
    access_token = request.COOKIES.get('stack-access-token')
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if user_response.status_code != 200:
        return JsonResponse({'error': 'Not authenticated'}, status=401)
    
    user_id = user_response.json()['id']
    
    # Create checkout URL
    checkout_response = requests.post(
        'https://api.stack-auth.com/api/v1/payments/purchases/create-purchase-url',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'customer_type': 'user',
            'customer_id': user_id,
            'product_id': product_id,
        }
    )
    
    if checkout_response.status_code != 200:
        return JsonResponse({'error': 'Failed to create checkout'}, status=500)
    
    return redirect(checkout_response.json()['url'])`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import Cookie, HTTPException
from fastapi.responses import RedirectResponse

@app.post("/checkout/{product_id}")
async def create_checkout(
    product_id: str,
    stack_access_token: str = Cookie(None, alias="stack-access-token")
):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        }
    )
    
    if user_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_id = user_response.json()['id']
    
    # Create checkout URL
    checkout_response = requests.post(
        'https://api.stack-auth.com/api/v1/payments/purchases/create-purchase-url',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'customer_type': 'user',
            'customer_id': user_id,
            'product_id': product_id,
        }
    )
    
    if checkout_response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to create checkout")
    
    return RedirectResponse(url=checkout_response.json()['url'])`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import request, jsonify, redirect

@app.route('/checkout/<product_id>', methods=['POST'])
def create_checkout(product_id):
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if user_response.status_code != 200:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = user_response.json()['id']
    
    # Create checkout URL
    checkout_response = requests.post(
        'https://api.stack-auth.com/api/v1/payments/purchases/create-purchase-url',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        json={
            'customer_type': 'user',
            'customer_id': user_id,
            'product_id': product_id,
        }
    )
    
    if checkout_response.status_code != 200:
        return jsonify({'error': 'Failed to create checkout'}), 500
    
    return redirect(checkout_response.json()['url'])`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'team-checkout-url': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function TeamPurchaseButton({ 
  teamId, 
  productId 
}: { 
  teamId: string;
  productId: string;
}) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(teamId);

  const handlePurchase = async () => {
    if (!team) return;
    
    const checkoutUrl = await team.createCheckoutUrl({
      productId,
    });
    
    window.location.href = checkoutUrl;
  };

  return (
    <button onClick={handlePurchase} disabled={!team}>
      Purchase for Team
    </button>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/team-purchase-button.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function TeamPurchasePage({ 
  params 
}: { 
  params: { teamId: string };
}) {
  const { teamId } = params;
  const user = await stackServerApp.getUser({ or: 'redirect' });
  const team = await user.getTeam(teamId);
  
  if (!team) {
    return <div>Team not found</div>;
  }
  
  const checkoutUrl = await team.createCheckoutUrl({
    productId: "prod_team_seats",
  });
  
  return (
    <a href={checkoutUrl}>
      Purchase Additional Seats
    </a>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/teams/[teamId]/purchase/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";

export default function TeamPurchaseButton({ 
  teamId, 
  productId 
}: { 
  teamId: string;
  productId: string;
}) {
  const user = useUser({ or: 'redirect' });
  const team = user.useTeam(teamId);

  const handlePurchase = async () => {
    if (!team) return;
    
    const checkoutUrl = await team.createCheckoutUrl({
      productId,
    });
    
    window.location.href = checkoutUrl;
  };

  return (
    <button onClick={handlePurchase} disabled={!team}>
      Purchase for Team
    </button>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'components/TeamPurchaseButton.tsx'
      },
    ] as CodeExample[],

    'get-item': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";
import { useEffect, useState } from "react";

export default function CreditsDisplay() {
  const user = useUser({ or: 'redirect' });
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    async function loadCredits() {
      const item = await user.getItem("credits");
      setCredits(item.nonNegativeQuantity);
    }
    loadCredits();
  }, [user]);

  if (credits === null) {
    return <div>Loading...</div>;
  }

  return <div>Available Credits: {credits}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/credits-display.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function CreditsPage() {
  const user = await stackServerApp.getUser({ or: 'redirect' });
  const credits = await user.getItem("credits");
  
  return (
    <div>
      <h1>Your Credits</h1>
      <p>Available: {credits.nonNegativeQuantity}</p>
      <p>Balance: {credits.quantity}</p>
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/credits/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";
import { useEffect, useState } from "react";

export default function CreditsDisplay() {
  const user = useUser({ or: 'redirect' });
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    async function loadCredits() {
      const item = await user.getItem("credits");
      setCredits(item.nonNegativeQuantity);
    }
    loadCredits();
  }, [user]);

  if (credits === null) {
    return <div>Loading...</div>;
  }

  return <div>Available Credits: {credits}</div>;
}`,
        highlightLanguage: 'typescript',
        filename: 'components/CreditsDisplay.tsx'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import requests
from django.http import JsonResponse

def get_user_item(request, item_id):
    access_token = request.COOKIES.get('stack-access-token')
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if user_response.status_code != 200:
        return JsonResponse({'error': 'Not authenticated'}, status=401)
    
    user_id = user_response.json()['id']
    
    # Get item quantity
    item_response = requests.get(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{user_id}/{item_id}',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        }
    )
    
    if item_response.status_code != 200:
        return JsonResponse({'error': 'Failed to get item'}, status=500)
    
    item = item_response.json()
    return JsonResponse({
        'display_name': item['display_name'],
        'quantity': item['quantity'],
        'non_negative_quantity': max(0, item['quantity']),
    })`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import Cookie, HTTPException

@app.get("/items/{item_id}")
async def get_user_item(
    item_id: str,
    stack_access_token: str = Cookie(None, alias="stack-access-token")
):
    if not stack_access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': stack_access_token,
        }
    )
    
    if user_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user_id = user_response.json()['id']
    
    # Get item quantity
    item_response = requests.get(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{user_id}/{item_id}',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        }
    )
    
    if item_response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to get item")
    
    item = item_response.json()
    return {
        'display_name': item['display_name'],
        'quantity': item['quantity'],
        'non_negative_quantity': max(0, item['quantity']),
    }`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import request, jsonify

@app.route('/items/<item_id>')
def get_user_item(item_id):
    access_token = request.cookies.get('stack-access-token')
    if not access_token:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Get the current user
    user_response = requests.get(
        'https://api.stack-auth.com/api/v1/users/me',
        headers={
            'x-stack-access-type': 'client',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-access-token': access_token,
        }
    )
    
    if user_response.status_code != 200:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = user_response.json()['id']
    
    # Get item quantity
    item_response = requests.get(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{user_id}/{item_id}',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        }
    )
    
    if item_response.status_code != 200:
        return jsonify({'error': 'Failed to get item'}), 500
    
    item = item_response.json()
    return jsonify({
        'display_name': item['display_name'],
        'quantity': item['quantity'],
        'non_negative_quantity': max(0, item['quantity']),
    })`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'use-item': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function CreditsWidget() {
  const user = useUser({ or: 'redirect' });
  // useItem provides real-time updates when quantity changes
  const credits = user.useItem("credits");

  return (
    <div className="credits-widget">
      <h3>Available Credits</h3>
      <div className="credits-count">
        {credits.nonNegativeQuantity}
      </div>
      <small>{credits.displayName}</small>
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/credits-widget.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";

export default function CreditsWidget() {
  const user = useUser({ or: 'redirect' });
  // useItem provides real-time updates when quantity changes
  const credits = user.useItem("credits");

  return (
    <div className="credits-widget">
      <h3>Available Credits</h3>
      <div className="credits-count">
        {credits.nonNegativeQuantity}
      </div>
      <small>{credits.displayName}</small>
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'components/CreditsWidget.tsx'
      },
    ] as CodeExample[],

    'consume-credits-server': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

// Safe credit consumption that prevents negative balances
export async function consumeCredits(userId: string, amount: number) {
  const user = await stackServerApp.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }
  
  const credits = await user.getItem("credits");
  
  // tryDecreaseQuantity is atomic and race-condition-safe
  const success = await credits.tryDecreaseQuantity(amount);
  
  if (!success) {
    throw new Error("Insufficient credits");
  }
  
  return { remaining: credits.quantity - amount };
}`,
        highlightLanguage: 'typescript',
        filename: 'lib/credits.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { stackServerApp } from "./stack/server.js";

app.post('/api/consume-credits', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    
    const user = await stackServerApp.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const credits = await user.getItem("credits");
    
    // tryDecreaseQuantity is atomic and race-condition-safe
    const success = await credits.tryDecreaseQuantity(amount);
    
    if (!success) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }
    
    res.json({ remaining: credits.quantity - amount });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});`,
        highlightLanguage: 'typescript',
        filename: 'server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { stackServerApp } from "./stack/server.js";

async function consumeCredits(userId, amount) {
  const user = await stackServerApp.getUser(userId);
  if (!user) {
    throw new Error('User not found');
  }
  
  const credits = await user.getItem("credits");
  
  // tryDecreaseQuantity is atomic and race-condition-safe
  const success = await credits.tryDecreaseQuantity(amount);
  
  if (!success) {
    throw new Error('Insufficient credits');
  }
  
  return { remaining: credits.quantity - amount };
}`,
        highlightLanguage: 'javascript',
        filename: 'credits.js'
      },
      {
        language: 'Python',
        framework: 'Django',
        code: `import json
import requests
from django.http import JsonResponse

def consume_item(request, item_id):
    data = json.loads(request.body)
    user_id = data['user_id']
    amount = data['amount']
    
    # Decrease quantity atomically (allow_negative=false prevents overdraft)
    update_response = requests.post(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{user_id}/{item_id}/update-quantity',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        params={
            'allow_negative': 'false',  # Prevents negative balance
        },
        json={
            'delta': -amount,
        }
    )
    
    if update_response.status_code == 400:
        return JsonResponse({'error': 'Insufficient balance'}, status=400)
    
    if update_response.status_code != 200:
        return JsonResponse({'error': 'Failed to update item'}, status=500)
    
    return JsonResponse({'success': True})`,
        highlightLanguage: 'python',
        filename: 'views.py'
      },
      {
        language: 'Python',
        framework: 'FastAPI',
        code: `import requests
from fastapi import HTTPException
from pydantic import BaseModel

class ConsumeItemRequest(BaseModel):
    user_id: str
    item_id: str
    amount: int

@app.post("/consume-item")
async def consume_item(request: ConsumeItemRequest):
    # Decrease quantity atomically (allow_negative=false prevents overdraft)
    update_response = requests.post(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{request.user_id}/{request.item_id}/update-quantity',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        params={
            'allow_negative': 'false',  # Prevents negative balance
        },
        json={
            'delta': -request.amount,
        }
    )
    
    if update_response.status_code == 400:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    if update_response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to update item")
    
    return {'success': True}`,
        highlightLanguage: 'python',
        filename: 'main.py'
      },
      {
        language: 'Python',
        framework: 'Flask',
        code: `import requests
from flask import request, jsonify

@app.route('/consume-item/<item_id>', methods=['POST'])
def consume_item(item_id):
    data = request.get_json()
    user_id = data['user_id']
    amount = data['amount']
    
    # Decrease quantity atomically (allow_negative=false prevents overdraft)
    update_response = requests.post(
        f'https://api.stack-auth.com/api/v1/payments/items/user/{user_id}/{item_id}/update-quantity',
        headers={
            'x-stack-access-type': 'server',
            'x-stack-project-id': stack_project_id,
            'x-stack-publishable-client-key': stack_publishable_client_key,
            'x-stack-secret-server-key': stack_secret_server_key,
        },
        params={
            'allow_negative': 'false',  # Prevents negative balance
        },
        json={
            'delta': -amount,
        }
    )
    
    if update_response.status_code == 400:
        return jsonify({'error': 'Insufficient balance'}), 400
    
    if update_response.status_code != 200:
        return jsonify({'error': 'Failed to update item'}), 500
    
    return jsonify({'success': True})`,
        highlightLanguage: 'python',
        filename: 'app.py'
      },
    ] as CodeExample[],

    'list-products': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'client',
        code: `"use client";
import { useUser } from "@stackframe/stack";

export default function MyProducts() {
  const user = useUser({ or: 'redirect' });
  const products = user.useProducts();

  return (
    <div>
      <h2>Your Products</h2>
      {products.length === 0 ? (
        <p>No products purchased yet.</p>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={product.id ?? product.displayName}>
              {product.displayName} (×{product.quantity})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/components/my-products.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

export default async function ProductsPage() {
  const user = await stackServerApp.getUser({ or: 'redirect' });
  const products = await user.listProducts();
  
  return (
    <div>
      <h2>Your Products</h2>
      {products.length === 0 ? (
        <p>No products purchased yet.</p>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={product.id ?? product.displayName}>
              {product.displayName} (×{product.quantity})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'app/products/page.tsx'
      },
      {
        language: 'JavaScript',
        framework: 'React',
        code: `import { useUser } from "@stackframe/react";

export default function MyProducts() {
  const user = useUser({ or: 'redirect' });
  const products = user.useProducts();

  return (
    <div>
      <h2>Your Products</h2>
      {products.length === 0 ? (
        <p>No products purchased yet.</p>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={product.id ?? product.displayName}>
              {product.displayName} (×{product.quantity})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}`,
        highlightLanguage: 'typescript',
        filename: 'components/MyProducts.tsx'
      },
    ] as CodeExample[],

    'grant-product-server': [
      {
        language: 'JavaScript',
        framework: 'Next.js',
        variant: 'server',
        code: `import { stackServerApp } from "@/stack/server";

// Grant a product to a user (server-side only)
export async function grantProductToUser(userId: string, productId: string) {
  const user = await stackServerApp.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }
  
  await user.grantProduct({
    productId,
    quantity: 1, // Optional, defaults to 1
  });
  
  return { success: true };
}

// Inline products mirror the REST schema, so fields stay in snake_case
const bonusCreditsProduct = {
  display_name: "Bonus Credits",
  customer_type: "user",
  server_only: true,
  stackable: false,
  prices: {
    manual: { USD: "0" },
  },
  included_items: {
    credits: { quantity: 100 },
  },
} as const;

// Grant a product with an inline definition (no pre-configured product needed)
export async function grantInlineProduct(userId: string) {
  const user = await stackServerApp.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }
  
  await user.grantProduct({
    product: bonusCreditsProduct,
  });
  
  return { success: true };
}`,
        highlightLanguage: 'typescript',
        filename: 'lib/products.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Express',
        code: `import { stackServerApp } from "./stack/server.js";

app.post('/api/grant-product', async (req, res) => {
  try {
    const { userId, productId } = req.body;
    
    const user = await stackServerApp.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await user.grantProduct({
      productId,
      quantity: 1,
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to grant product' });
  }
});`,
        highlightLanguage: 'typescript',
        filename: 'server.ts'
      },
      {
        language: 'JavaScript',
        framework: 'Node.js',
        code: `import { stackServerApp } from "./stack/server.js";

async function grantProductToUser(userId, productId) {
  const user = await stackServerApp.getUser(userId);
  if (!user) {
    throw new Error('User not found');
  }
  
  await user.grantProduct({
    productId,
    quantity: 1,
  });
  
  return { success: true };
}`,
        highlightLanguage: 'javascript',
        filename: 'products.js'
      },
    ] as CodeExample[],
  }
};
